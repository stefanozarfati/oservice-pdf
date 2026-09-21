// font-manager.js
// Modulo condiviso OService PDF Suite: gestione dei font in ./fonts/manifest.json.
// Usato da Attestati e da Retro Foto Orienteering. Nessuna dipendenza da CDN.
// Richiede che pdf-lib e fontkit siano già caricati globalmente nella pagina
// (./lib/pdf-lib-bundle.js e ./lib/fontkit.js) prima di usare le funzioni di embedding.
//
// API esposta come oggetto globale `FontManager`:
//   loadManifest()                                  -> Promise<manifest>
//   ensurePreviewFace(fontId, weight, italic?)      -> Promise<FontFace>  (carica e registra il font per l'anteprima a schermo)
//   embedPackagedFont(doc, fontId, weight, italic?) -> Promise<PDFFont>  (doc = PDFDocument con registerFontkit già chiamato)
//   systemFontsSupported()                          -> boolean
//   querySystemFonts()                              -> Promise<{ [famiglia]: FontData[] }>
//   embedSystemFont(doc, fontData)                  -> Promise<PDFFont>
//
// Il parametro `italic` (facoltativo, default false) chiede la variante corsivo vera del
// font, se il manifest la elenca in "styles"; altrimenti si usa automaticamente la variante
// diritta dello stesso peso (nessun corsivo finto/inclinato via trasformazione).

const FontManager = (function () {
  let manifestPromise = null;
  const fontBytesCache = {}; // "id-peso" -> Uint8Array (byte grezzi, riusabili su più PDFDocument)
  const previewInjected = {}; // "id-peso" -> true (per non duplicare i tag <style>)

  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch('./fonts/manifest.json').then(function (res) {
        if (!res.ok) throw new Error('Impossibile caricare fonts/manifest.json (' + res.status + ')');
        return res.json();
      });
    }
    return manifestPromise;
  }

  function findFont(manifest, fontId) {
    const font = manifest.fonts.find(function (f) { return f.id === fontId; });
    if (!font) throw new Error('Font non presente nel manifest: ' + fontId);
    return font;
  }

  // Risolve peso+corsivo sul font reale disponibile: se il corsivo richiesto non esiste
  // per quel font (es. i decorativi/manoscritti sono un unico stile), usa la variante
  // diritta dello stesso peso — mai un corsivo finto. Restituisce sia il percorso file
  // sia lo stile realmente usato, perché chi chiama deve saperlo (screen preview e cache).
  function resolveFontFile(font, weight, italic) {
    const wantItalic = !!italic && (font.styles || []).indexOf('italic') !== -1;
    const key = String(weight) + (wantItalic ? 'i' : '');
    const path = font.files[key];
    if (path) return { path: path, italic: wantItalic };
    if (!font.files[String(weight)]) throw new Error('Peso ' + weight + ' non disponibile per il font ' + font.id);
    return { path: font.files[String(weight)], italic: false };
  }

  // Registra il font per l'anteprima a schermo e ne ATTENDE il caricamento completo
  // prima di risolvere: canvas.measureText() (usato da wrapByMeasure per l'auto-riduzione)
  // deve poter contare sul font vero fin dalla prima misurazione, non su un fallback
  // temporaneo. Per questo si usa la Font Loading API (FontFace + .load()) invece di
  // un @font-face via <style>, che il browser potrebbe scaricare in modo pigro al primo
  // utilizzo. Riusa gli stessi byte di embedPackagedFont: un solo fetch, e garanzia che
  // quel che si vede a schermo sia esattamente quel che finisce nel PDF.
  function ensurePreviewFace(fontId, weight, italic) {
    const key = fontId + '-' + weight + (italic ? 'i' : '');
    if (previewInjected[key]) return previewInjected[key];
    const promise = (async function () {
      const manifest = await loadManifest();
      const font = findFont(manifest, fontId);
      const bytes = await fetchFontBytes(fontId, weight, italic);
      const resolved = resolveFontFile(font, weight, italic);
      const face = new FontFace(font.name, bytes.buffer, { weight: String(weight), style: resolved.italic ? 'italic' : 'normal' });
      const loaded = await face.load();
      document.fonts.add(loaded);
      return loaded;
    })();
    previewInjected[key] = promise;
    return promise;
  }

  async function fetchFontBytes(fontId, weight, italic) {
    const manifest = await loadManifest();
    const font = findFont(manifest, fontId);
    const resolved = resolveFontFile(font, weight, italic);
    const key = fontId + '-' + weight + (resolved.italic ? 'i' : '');
    if (fontBytesCache[key]) return fontBytesCache[key];
    const url = './' + resolved.path;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Impossibile scaricare il font ' + fontId + ' (' + res.status + ')');
    const bytes = new Uint8Array(await res.arrayBuffer());
    fontBytesCache[key] = bytes;
    return bytes;
  }

  async function embedPackagedFont(doc, fontId, weight, italic) {
    const bytes = await fetchFontBytes(fontId, weight, italic);
    try {
      return await doc.embedFont(bytes, { subset: true });
    } catch (_) {
      return await doc.embedFont(bytes, { subset: false });
    }
  }

  function systemFontsSupported() {
    return typeof window !== 'undefined' && 'queryLocalFonts' in window;
  }

  async function querySystemFonts() {
    if (!systemFontsSupported()) return {};
    let fonts;
    try {
      fonts = await window.queryLocalFonts();
    } catch (_) {
      return {}; // permesso negato o annullato dall'utente
    }
    const byFamily = {};
    for (const f of fonts) {
      if (!byFamily[f.family]) byFamily[f.family] = [];
      byFamily[f.family].push(f);
    }
    return byFamily;
  }

  async function embedSystemFont(doc, fontData) {
    const blob = await fontData.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      return await doc.embedFont(bytes, { subset: true });
    } catch (_) {
      return await doc.embedFont(bytes, { subset: false });
    }
  }

  return {
    loadManifest: loadManifest,
    ensurePreviewFace: ensurePreviewFace,
    embedPackagedFont: embedPackagedFont,
    systemFontsSupported: systemFontsSupported,
    querySystemFonts: querySystemFonts,
    embedSystemFont: embedSystemFont
  };
})();
