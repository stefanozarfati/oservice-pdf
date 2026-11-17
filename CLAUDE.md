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
