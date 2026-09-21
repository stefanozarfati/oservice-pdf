const CACHE='oservice-suite-v29';
const ASSETS=[
  './','./index.html','./attestati.html','./impaginatore.html','./comprimi.html','./classifiche.html','./retro-foto-orienteering.html','./manifest.json',
  './gs/gs.js',  // gs.wasm (~15MB) NON in precache: cache-first al primo uso
  './lib/pdf-lib-bundle.js','./lib/fontkit.js','./lib/font-manager.js',
  './icon-192.png','./icon-512.png','./icon-512-maskable.png',
  './tesseract/tesseract.min.js','./tesseract/worker.min.js','./tesseract/ita.traineddata',
  './tesseract/core/tesseract-core-simd-lstm.wasm','./tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './tesseract/core/tesseract-core-lstm.wasm','./tesseract/core/tesseract-core-lstm.wasm.js',
  './pdfjs/pdf.min.js','./pdfjs/pdf.worker.min.js',
  './fonts/manifest.json',
  './fonts/cinzel/cinzel-400.woff2','./fonts/cinzel/cinzel-700.woff2',
  './fonts/allura/allura-400.woff2',
  './fonts/abril-fatface/abril-fatface-400.woff2',
  './fonts/playfair-display/playfair-display-400.woff2','./fonts/playfair-display/playfair-display-400i.woff2',
  './fonts/playfair-display/playfair-display-700.woff2','./fonts/playfair-display/playfair-display-700i.woff2',
  './fonts/lora/lora-400.woff2','./fonts/lora/lora-400i.woff2',
  './fonts/lora/lora-700.woff2','./fonts/lora/lora-700i.woff2',
  './fonts/cormorant-garamond/cormorant-garamond-400.woff2','./fonts/cormorant-garamond/cormorant-garamond-400i.woff2',
  './fonts/cormorant-garamond/cormorant-garamond-700.woff2','./fonts/cormorant-garamond/cormorant-garamond-700i.woff2',
  './fonts/open-sans/open-sans-400.woff2','./fonts/open-sans/open-sans-400i.woff2',
  './fonts/open-sans/open-sans-700.woff2','./fonts/open-sans/open-sans-700i.woff2',
  './fonts/montserrat/montserrat-400.woff2','./fonts/montserrat/montserrat-400i.woff2',
  './fonts/montserrat/montserrat-700.woff2','./fonts/montserrat/montserrat-700i.woff2',
  './fonts/oswald/oswald-400.woff2','./fonts/oswald/oswald-700.woff2',
  './fonts/pt-serif/pt-serif-400.woff2','./fonts/pt-serif/pt-serif-400i.woff2',
  './fonts/pt-serif/pt-serif-700.woff2','./fonts/pt-serif/pt-serif-700i.woff2',
  './fonts/roboto-mono/roboto-mono-400.woff2','./fonts/roboto-mono/roboto-mono-400i.woff2',
  './fonts/roboto-mono/roboto-mono-700.woff2','./fonts/roboto-mono/roboto-mono-700i.woff2',
  './fonts/dancing-script/dancing-script-400.woff2','./fonts/dancing-script/dancing-script-700.woff2',
  './fonts/sacramento/sacramento-400.woff2'
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
