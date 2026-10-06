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
// POOL PERSONALE (font importati dall'utente, salvati nel browser — IndexedDB — e condivisi da
// tutti gli strumenti della Suite, che stanno sulla stessa origine). Non vanno mai nel repo
// pubblico: restano solo sul dispositivo (molti font di sistema hanno licenze non ridistribuibili).
// I font importati compaiono in loadManifest() come font normali (category 'personale', pool:true).
//   poolList()                      -> Promise<record[]>       ({id, name, files:{'400':ArrayBuffer,...}})
//   poolAddFontBytes(bytes, hintPs?)-> Promise<{families:[nomi], faces:n}>  (TTF/OTF/TTC; i TTC vengono separati)
//   poolRemove(id)                  -> Promise<void>
//   reloadManifest()                -> Promise<manifest>       (da chiamare dopo import/rimozione)
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
      }).then(async function (m) {
        try { m.fonts = m.fonts.concat(await poolManifestEntries(m.fonts)); } catch (_) { /* pool non disponibile (es. navigazione privata): restano i font di base */ }
        return m;
      });
    }
    return manifestPromise;
  }
  function reloadManifest() {
    manifestPromise = null;
    Object.keys(fontBytesCache).forEach(function (k) { if (k.indexOf('pool-') === 0) delete fontBytesCache[k]; });
    Object.keys(previewInjected).forEach(function (k) { if (k.indexOf('pool-') === 0) delete previewInjected[k]; });
    return loadManifest();
  }

  // ---------------- POOL PERSONALE (IndexedDB) ----------------
  var DB_NAME = 'oservice-fontpool', STORE = 'fonts';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function idbDo(mode, fn) {
    var db = await idb();
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), out = fn(st);
      tx.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
    });
  }
  function poolList() { return idbDo('readonly', function (st) { return st.getAll(); }); }
  function poolGet(id) { return idbDo('readonly', function (st) { return st.get(id); }); }
  function poolPut(rec) { return idbDo('readwrite', function (st) { return st.put(rec); }); }
  async function poolRemove(id) { await idbDo('readwrite', function (st) { return st.delete(id); }); await reloadManifest(); }
  async function poolManifestEntries(baseFonts) {
    var recs = await poolList(), out = [];
    recs.sort(function (a, b) { return a.name.localeCompare(b.name); });
    recs.forEach(function (r) {
      var files = {}, weights = {}, styles = { normal: true };
      Object.keys(r.files).forEach(function (k) { files[k] = 'pool:' + r.id + ':' + k; weights[parseInt(k, 10)] = true; if (/i$/.test(k)) styles.italic = true; });
      out.push({ id: r.id, name: r.name, category: 'personale', weights: Object.keys(weights).map(Number).sort(), styles: Object.keys(styles), files: files, license: 'personale', pool: true });
    });
    return out;
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
    if (resolved.path.indexOf('pool:') === 0) {                     // font personale: i byte stanno in IndexedDB
      const parts = resolved.path.split(':'), rec = await poolGet(parts[1]);
      if (!rec || !rec.files[parts[2]]) throw new Error('Font personale non trovato: ' + fontId);
      const pb = new Uint8Array(rec.files[parts[2]]);
      fontBytesCache[key] = pb;
      return pb;
    }
    const url = './' + resolved.path;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Impossibile scaricare il font ' + fontId + ' (' + res.status + ')');
    const bytes = new Uint8Array(await res.arrayBuffer());
    fontBytesCache[key] = bytes;
    return bytes;
  }

  // Font CFF (.otf con intestazione 'OTTO'): con subset:true pdf-lib produce un font che alcuni
  // lettori (MuPDF) rifiutano senza dare errore -> si incorpora intero. I TrueType si riducono (subset).
  const isCff = function (b) { return b.length > 4 && b[0] === 0x4F && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4F; };
  // pdf-lib scrive i font OpenType-CFF (.otf) come TrueType (CIDFontType2/FontFile2): non a norma,
  // Acrobat può non mostrarli. Prima del salvataggio li riscrivo come CIDFontType0 + FontFile3/OpenType.
  function hookCffFix(doc) {
    if (doc.__cffHook) return; doc.__cffHook = true;
    const orig = doc.save.bind(doc);
    doc.save = async function (opts) { try { await fixCffFonts(doc); } catch (e) { console.warn('fixCffFonts', e); } return orig(opts); };
  }
  async function fixCffFonts(doc) {
    const L = PDFLib, N = L.PDFName, ctx = doc.context;
    await doc.flush();
    const objs = ctx.enumerateIndirectObjects();
    for (const [, d] of objs) {
      if (!(d instanceof L.PDFDict)) continue;
      const ff = d.get(N.of('FontFile2'));
      if (!ff) continue;
      const st = ctx.lookup(ff);
      let raw; try { raw = L.decodePDFRawStream ? L.decodePDFRawStream(st).decode() : st.contents; } catch (_) { raw = st && st.contents; }
      if (!raw || !isCff(raw)) continue;
      // descriptor: FontFile2 -> FontFile3 (/Subtype /OpenType)
      st.dict.set(N.of('Subtype'), N.of('OpenType'));
      d.delete(N.of('FontFile2')); d.set(N.of('FontFile3'), ff);
      // il CIDFont che usa questo descriptor
      for (const [, f] of objs) {
        if (!(f instanceof L.PDFDict)) continue;
        const sub = f.get(N.of('Subtype'));
        if (!sub || sub.toString() !== '/CIDFontType2') continue;
        const fd = f.get(N.of('FontDescriptor'));
        if (fd && ctx.lookup(fd) === d) { f.set(N.of('Subtype'), N.of('CIDFontType0')); f.delete(N.of('CIDToGIDMap')); }
      }
    }
  }
  async function embedBytes(doc, bytes) {
    if (isCff(bytes)) { hookCffFix(doc); return await doc.embedFont(bytes, { subset: false }); }
    try { return await doc.embedFont(bytes, { subset: true }); }
    catch (_) { return await doc.embedFont(bytes, { subset: false }); }
  }
  async function embedPackagedFont(doc, fontId, weight, italic) {
    return embedBytes(doc, await fetchFontBytes(fontId, weight, italic));
  }

  // Collezioni di font (.ttc/.otc): pdf-lib non le accetta. Si estrae il font n-esimo in un file autonomo
  // (copia delle tabelle, ricalcolo degli offset).
  const isTtc = function (b) { return b.length > 12 && b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66; };
  function splitTtc(bytes, index) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(8);
    if (index < 0 || index >= n) throw new Error('Indice font non valido nella collezione.');
    const off = dv.getUint32(12 + index * 4), numTables = dv.getUint16(off + 4);
    const tables = [];
    for (let i = 0; i < numTables; i++) { const e = off + 12 + i * 16; tables.push({ tag: dv.getUint32(e), sum: dv.getUint32(e + 4), off: dv.getUint32(e + 8), len: dv.getUint32(e + 12) }); }
    let size = 12 + numTables * 16; tables.forEach(function (t) { size += (t.len + 3) & ~3; });
    const out = new Uint8Array(size), od = new DataView(out.buffer);
    out.set(bytes.subarray(off, off + 12), 0);
    let pos = 12 + numTables * 16;
    tables.forEach(function (t, i) {
      out.set(bytes.subarray(t.off, t.off + t.len), pos);
      const e = 12 + i * 16; od.setUint32(e, t.tag); od.setUint32(e + 4, t.sum); od.setUint32(e + 8, pos); od.setUint32(e + 12, t.len);
      pos += (t.len + 3) & ~3;
    });
    return out;
  }
  // Byte pronti per pdf-lib: se è una collezione, estrae la faccia giusta (per nome PostScript, altrimenti la prima)
  function normalizeFontBytes(bytes, postscriptName) {
    if (!isTtc(bytes)) return bytes;
    let idx = 0;
    try { const col = fontkit.create(bytes); if (postscriptName) { const k = col.fonts.findIndex(function (f) { return f.postscriptName === postscriptName; }); if (k >= 0) idx = k; } } catch (_) { /* ripiega sulla prima */ }
    return splitTtc(bytes, idx);
  }

  // ---- import nella pool ----
  function slotFor(face) {                                         // peso reale -> casella 400/700, corsivo sì/no
    const w = (face['OS/2'] && face['OS/2'].usWeightClass) || 400;
    const sub = (face.subfamilyName || '') + ' ' + (face.postscriptName || '');
    const italic = !!face.italicAngle || /italic|oblique/i.test(sub);
    const target = w >= 600 ? 700 : 400;
    return { key: String(target) + (italic ? 'i' : ''), dist: Math.abs(w - target) };
  }
  async function poolAddFontBytes(input, hintPs) {
    let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const m4 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (m4 === 'wOFF' || m4 === 'wOF2') throw new Error('I font WOFF/WOFF2 non si possono usare nei PDF: serve un file TTF, OTF o TTC.');
    const faces = [];
    if (isTtc(bytes)) {
      const col = fontkit.create(bytes);
      col.fonts.forEach(function (f, i) { if (!hintPs || f.postscriptName === hintPs) faces.push({ f: f, bytes: splitTtc(bytes, i) }); });
    } else faces.push({ f: fontkit.create(bytes), bytes: bytes });
    const touched = {};
    for (const it of faces) {
      const fam = (it.f.familyName || it.f.fullName || '').trim();
      if (!fam) continue;
      const id = 'pool-' + fam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const rec = (await poolGet(id)) || { id: id, name: fam, files: {}, dist: {}, addedAt: Date.now() };
      const sl = slotFor(it.f);
      if (rec.files[sl.key] === undefined || sl.dist < (rec.dist[sl.key] === undefined ? 999 : rec.dist[sl.key])) {
        rec.files[sl.key] = it.bytes.buffer.slice(it.bytes.byteOffset, it.bytes.byteOffset + it.bytes.byteLength);
        rec.dist[sl.key] = sl.dist;
      }
      await poolPut(rec); touched[fam] = true;
    }
    if (!Object.keys(touched).length) throw new Error('Nessun font riconosciuto in questo file.');
    await reloadManifest();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
    return { families: Object.keys(touched), faces: faces.length };
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
      return null; // permesso negato: null si distingue da {} (nessun font trovato), per poter avvisare l'utente
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
    const bytes = normalizeFontBytes(new Uint8Array(await blob.arrayBuffer()), fontData.postscriptName);
    return embedBytes(doc, bytes);
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
    if (byFamily === null) return 'denied'; // permesso negato: distinto dall'annullamento silenzioso dell'utente
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
    ensureSystemPreviewFace: ensureSystemPreviewFace,
    reloadManifest: reloadManifest,
    poolList: poolList,
    poolAddFontBytes: poolAddFontBytes,
    poolRemove: poolRemove,
    normalizeFontBytes: normalizeFontBytes
  };
})();
