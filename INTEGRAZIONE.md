INTEGRAZIONE COMPRESSORE NELLA OSERVICE PDF SUITE
=================================================
Repo: stefanozarfati/oservice-pdf (ramo main)

NON caricare il vecchio "index.html" del compressore: sovrascriverebbe il menu.
Usa questi file, che rispettano la struttura esistente.

FILE DA CARICARE (via github.com -> Add file -> Upload files)
-------------------------------------------------------------
Nella ROOT del repo (sovrascrivono / aggiungono):
  index.html      -> SOSTITUISCE il menu (ora ha 3 card: +Comprimi PDF)
  sw.js           -> SOSTITUISCE il service worker (cache v17 -> v18)
  comprimi.html   -> NUOVO strumento compressore

Nella sottocartella gs/ (crearla durante l'upload):
  gs/gs.mjs
  gs/gs.js
  gs/browser.js
  gs/gs.wasm   (16 MB)
  gs/LICENSE   (AGPL Ghostscript)

COME CREARE LA CARTELLA gs/ SENZA TERMINALE
-------------------------------------------
Nell'upload web di GitHub, trascina direttamente una cartella chiamata "gs"
contenente i 4 file: GitHub mantiene la struttura. In alternativa, per ogni
file usa "Add file -> Create new file" e scrivi il nome come  gs/gs.mjs
(la barra crea automaticamente la cartella).

COSA NON CAMBIA
---------------
attestati.html, impaginatore.html, manifest.json, icone, pdfjs/, lib/,
tesseract/  -> restano intatti, non li toccare.

DOPO IL CARICAMENTO
-------------------
- Apri la Suite: vedrai la terza card "Comprimi PDF".
- La prima apertura del compressore scarica gs.wasm (16 MB), poi resta offline.
- Il bump a v18 fa sì che il service worker aggiorni menu e strumenti.
