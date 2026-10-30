#!/bin/bash
# Alza di uno il numero di versione OVUNQUE e pubblica.
# Il numero e' lo stesso che si legge in Home ("Versione NN") ed e' quello che
# fa capire ai dispositivi che c'e' una copia nuova: se non si alza, restano
# indietro senza accorgersene. Usare SEMPRE questo al posto di git push.
set -e
cd "$(dirname "$0")"

python3 - <<'PY'
import io, re, glob
s = io.open('sw.js', encoding='utf-8').read()
vecchia = int(re.search(r"const VERSIONE='(\d+)'", s).group(1))
nuova = str(vecchia + 1)

io.open('sw.js','w',encoding='utf-8').write(
    re.sub(r"(const VERSIONE=')\d+(')", r'\g<1>' + nuova + r'\g<2>', s))

for p in glob.glob('*.html'):
    t = io.open(p, encoding='utf-8').read()
    t2 = re.sub(r'(window\.VERSIONE=")\d+(")', r'\g<1>' + nuova + r'\g<2>', t)
    t2 = re.sub(r'(Versione )\d+', r'\g<1>' + nuova, t2)
    if t2 != t: io.open(p,'w',encoding='utf-8').write(t2)

io.open('versione.json','w',encoding='utf-8').write('{"versione": "%s"}\n' % nuova)
print('versione %d -> %s' % (vecchia, nuova))
PY

git add -A
git commit -q -m "${1:-Pubblicazione}" || echo "(niente da committare)"
git push -q origin HEAD
echo "pubblicato. GitHub Pages ci mette 1-2 minuti."
