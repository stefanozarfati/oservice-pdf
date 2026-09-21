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
//   pickSystemFont()                                -> Promise<{family, variants: FontData[]} | null>  (mostra il selettore, solo Chrome/Edge desktop)
//   bestSystemVariant(variants, bold?, italic?)     -> FontData  (sceglie la variante di stile più vicina a quanto richiesto)
//   ensureSystemPreviewFace(fontData, weight?, italic?) -> Promise<FontFace>  (anteprima di UNA variante di sistema)
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

  // Tra le varianti di stile di una famiglia (Regular/Bold/Italic/Bold Italic...) sceglie
  // quella più vicina al grassetto/corsivo richiesti, leggendo il campo "style" — testo
  // libero non standardizzato che il sistema operativo fornisce, quindi si va a punteggio
  // invece che a corrispondenza esatta. Nessun errore possibile: ripiega sempre sulla
  // variante con punteggio migliore, mai un grassetto o corsivo finto.
  function bestSystemVariant(variants, bold, italic) {
    function score(v) {
      const s = (v.style || '').toLowerCase();
      const hasBold = /bold|semibold|black|heavy/.test(s);
      const hasItalic = /italic|oblique/.test(s);
      let pts = 0;
      if (!!bold === hasBold) pts += 2;
      if (!!italic === hasItalic) pts += 2;
      if (!bold && !italic && /regular|normal|book/.test(s)) pts += 1;
      return pts;
    }
    return variants.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }

  // Mostra un piccolo selettore autonomo (crea e distrugge il proprio markup: chi chiama
  // non deve predisporre nulla in pagina) con l'elenco dei font davvero installati,
  // raggruppati per famiglia. Risolve con { family, variants } se l'utente conferma,
  // con null se annulla, se il permesso viene negato, o se il browser non supporta
  // l'accesso ai font locali (Chrome/Edge desktop soltanto).
  async function pickSystemFont() {
    if (!systemFontsSupported()) return null;
    const byFamily = await querySystemFonts();
    const families = Object.keys(byFamily).sort(function (a, b) { return a.localeCompare(b); });
    if (!families.length) return null;

    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,25,35,.45);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif';
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:14px;padding:20px;width:min(360px,90vw);box-shadow:0 20px 50px rgba(0,0,0,.3)';
      card.innerHTML =
        '<div style="font-weight:700;font-size:15px;margin-bottom:10px;color:#1f2733">Scegli un font dal tuo computer</div>' +
        '<select size="10" style="width:100%;font-size:14px;border:1px solid #d7dde6;border-radius:8px;padding:6px"></select>' +
        '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
        '<button type="button" data-act="cancel" style="padding:8px 14px;border-radius:8px;border:1px solid #d7dde6;background:#fff;cursor:pointer;font-size:13px">Annulla</button>' +
        '<button type="button" data-act="ok" style="padding:8px 14px;border-radius:8px;border:0;background:#1f2733;color:#fff;cursor:pointer;font-size:13px">Usa questo font</button>' +
        '</div>';
      const select = card.querySelector('select');
      families.forEach(function (fam) {
        const opt = document.createElement('option');
        opt.value = fam;
        opt.textContent = fam;
        select.appendChild(opt);
      });
      select.selectedIndex = 0;
      function close(result) {
        document.body.removeChild(overlay);
        resolve(result);
      }
      card.querySelector('[data-act="cancel"]').onclick = function () { close(null); };
      card.querySelector('[data-act="ok"]').onclick = function () {
        const fam = select.value;
        close({ family: fam, variants: byFamily[fam] });
      };
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  // Carica per l'anteprima a schermo una variante di un font di sistema — stesso principio
  // di ensurePreviewFace: attende il caricamento completo prima di dire "pronto", perché
  // canvas.measureText() non deve mai misurare su un fallback temporaneo.
  async function ensureSystemPreviewFace(fontData, weight, italic) {
    const blob = await fontData.blob();
    const bytes = await blob.arrayBuffer();
    const face = new FontFace(fontData.family, bytes, { weight: String(weight || 400), style: italic ? 'italic' : 'normal' });
    const loaded = await face.load();
    document.fonts.add(loaded);
    return loaded;
  }

  return {
    loadManifest: loadManifest,
    ensurePreviewFace: ensurePreviewFace,
    embedPackagedFont: embedPackagedFont,
    systemFontsSupported: systemFontsSupported,
    querySystemFonts: querySystemFonts,
    embedSystemFont: embedSystemFont,
    pickSystemFont: pickSystemFont,
    bestSystemVariant: bestSystemVariant,
    ensureSystemPreviewFace: ensureSystemPreviewFace
  };
})();
