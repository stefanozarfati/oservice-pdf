# Istruzioni per Claude — OService PDF Suite

## Pubblicazione (decisa da Stefano il 15/10/2026)
Claude pubblica da solo su GitHub (commit + push su `main`) quando la modifica è finita e collaudata. Stefano non carica più a mano i file.

- **Prima del push:** collaudo reale in Chromium (clic veri, download veri). Si pubblica solo se i test passano.
- **Dopo il push:** dire a Stefano quali file sono stati pubblicati (con il codice del commit) e come verificare: attendere 1-2 minuti, Cmd+Shift+R due volte, controllare un elemento visibile nuovo (ad esempio "Versione NN" in Home).
- **Un commit per modifica**, solo i file della modifica.
- **`sw.js`** si cambia solo se serve (file nuovi o cambi alla cache): le pagine HTML si aggiornano da sole perché il service worker le prende prima dalla rete.
- **Chiedere prima** per azioni difficili da annullare: cancellare file, cambiare la struttura del repository, riscrivere la cronologia, operazioni a pagamento.

## Volantini Campi Scuola (17/11/2026)
`volantini.html` non è uno strumento della Suite: è una pagina che spiega e apre
l'app locale `~/App/oservice-volantini` (Python + PyMuPDF, su 127.0.0.1:8777).
Quell'app riscrive i PDF con i font originali dei modelli e salva nelle cartelle
dei clienti: non può girare nel browser. Se un giorno si volesse portarla dentro
la Suite, andrebbe riscritta da zero in JavaScript.

## Stile di lavoro
- Rispondere in italiano. Stefano non è un programmatore: spiegazioni semplici, comandi pronti da copiare e incollare, sempre con l'indicazione di dove eseguirli (Terminale, Console del browser, altro).
- Modifiche chirurgiche, non riscritture. Verificare nel codice o nella console prima di affermare.
- Guardare sempre l'output prodotto (PDF, schermata), non solo i test automatici.
- Note di stato del progetto: documenti `OServicePDF-stato-*.md` nel Project "OService PDF Suite" su claude.ai.

## Velocità — misurata il 25/11/2026 (Retro Foto Orienteering)

Stefano: *"lentissima per ogni operazione... certamente utilizza molta CPU e RAM...
e quasi sempre va a scatti"*. Misurato con un banco di prova (18 foto finte
4000×3000 da 2,4 MB l'una, Chrome headless su questo Mac), **prima → dopo**:

| operazione | prima | dopo |
|---|---|---|
| elenco dei progetti salvati | 6130 ms | **8 ms** |
| salvataggio progetto | 1001 ms | 489 ms |
| esportazione PDF 300 dpi | 5720 ms | 2508 ms |
| esportazione PDF 600 dpi | 10239 ms | 1715 ms |
| fotogramma peggiore trascinando un cursore | 3297 ms | 1093 ms |
| foto tenute in memoria | 42,7 MB | 23,8 MB |

Quattro cause, tutte verificate prima di correggerle:

1. **`getAll()` per riempire un elenco di nomi.** `refreshProjectList` leggeva
   *tutti* i progetti interi — foto comprese — per scriverne i nomi nel menu
   "Apri…". Ora usa `getAllKeys()`: la chiave dell'archivio **è** il nome.
   ⚠️ **Lo stesso difetto è ancora in `attestati.html`** (`renderProjList` →
   `idbAll()`): lì però la riga mostra anche data e numero di loghi, quindi non
   basta `getAllKeys` — servirebbe un indice leggero a parte. Non fatto.
2. **Foto tenute a grandezza di telefono.** 12 milioni di punti per stampare
   5 cm di carta. Ora `rimpicciolisciFoto()` le porta a `MAX_LATO_FOTO = 2400`
   appena entrano (e all'apertura dei progetti vecchi). Costa ~0,1-0,6 s per
   foto, una volta sola. Il ritaglio non si sposta: zoom e spostamento sono
   memorizzati **in proporzione**, non in punti.
3. **Un ridisegno per evento, non per fotogramma.** I cursori e i campi di testo
   chiamavano `recompute()` a ogni evento: decine al secondo, e ognuno rifà la
   griglia da zero. Ora passano da `recomputeSoon()` (un `requestAnimationFrame`).
   ⚠️ Chi deve leggere **subito** misure dall'anteprima (l'esportazione PDF) deve
   continuare a chiamare `recompute()` diretto.
   **`pname` (Nome progetto) è stato tolto dall'elenco dei controlli che
   ridisegnano**: non compare nell'anteprima, e scriverci dentro rifaceva tutta
   la griglia a ogni lettera.
4. **Giro inutile via base64 in esportazione.** `canvas.toDataURL` → `atob` →
   `Uint8Array` copiava ogni foto tre volte. Ora `telaInByte()` usa
   `canvas.toBlob`, e le tele si liberano appena usate (`canvas.width = 1`).

**Due cose che il banco di prova ha smentito**, da non rifare a sensazione:
- tenere in memoria le immagini già decodificate **non serve al ridisegno**
  (829 ms contro 851 ms: rumore). Serve all'**esportazione**, dove evita di
  decodificare di nuovo tutte le foto: per questo `cacheImmagini` resta.
- il costo di un fotogramma è **la griglia, non le foto**: 17 ms con 18 riquadri
  vuoti, 17 ms con 18 foto dentro. Per scendere sotto bisognerebbe smettere di
  rifare la griglia da zero (`gridArea.innerHTML=''`), che è una riscrittura.

**Verificato che il PDF non è cambiato**: a parità di progetto l'esportazione
produce **157670 byte prima e dopo**, stessa resa a schermo (66,2% di pagina
disegnata, stesse percentuali di rosso e verde), stesse misure A4.
Banco di prova in `/tmp` (sessione), non nel repository.
