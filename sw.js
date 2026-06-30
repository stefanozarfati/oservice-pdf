const CACHE='oservice-suite-v17';
const ASSETS=[
  './','./index.html','./attestati.html','./impaginatore.html','./manifest.json',
  './lib/pdf-lib-bundle.js',
  './icon-192.png','./icon-512.png','./icon-512-maskable.png',
  './tesseract/tesseract.min.js','./tesseract/worker.min.js','./tesseract/ita.traineddata',
  './tesseract/core/tesseract-core-simd-lstm.wasm','./tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './tesseract/core/tesseract-core-lstm.wasm','./tesseract/core/tesseract-core-lstm.wasm.js',
  './pdfjs/pdf.min.js','./pdfjs/pdf.worker.min.js'
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const isHTML = e.request.mode==='navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname==='';
  if(isHTML){
    // network-first: quando online prende sempre la versione aggiornata; offline ripiega sulla cache
    e.respondWith(
      fetch(e.request).then(resp=>{
        const cp=resp.clone();caches.open(CACHE).then(c=>{try{c.put(e.request,cp);}catch(_){}});return resp;
      }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
    );
  } else {
    // cache-first per i file statici pesanti (tesseract, pdfjs, librerie, icone)
    e.respondWith(
      caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
        const cp=resp.clone();caches.open(CACHE).then(c=>{try{c.put(e.request,cp);}catch(_){}});return resp;
      }).catch(()=>r))
    );
  }
});
