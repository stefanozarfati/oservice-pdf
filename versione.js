// AGGIORNAMENTO AUTOMATICO — condiviso da tutte le pagine della suite.
// Ogni pagina porta il proprio timbro in window.VERSIONE; qui si confronta
// con versione.json sul server. Se differisce: cache svuotate, service
// worker aggiornato, pagina ricaricata. Una volta sola, mai in ciclo.
(function () {
  if (!window.VERSIONE) return;

  async function controllaVersione() {
    try {
      const r = await fetch('versione.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.versione || d.versione === window.VERSIONE) return;
      if (sessionStorage.getItem('ricaricata') === d.versione) return;
      sessionStorage.setItem('ricaricata', d.versione);

      if ('caches' in window) {
        const k = await caches.keys();
        await Promise.all(k.map(n => caches.delete(n)));
      }
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { if (reg.waiting) reg.waiting.postMessage('aggiornati'); await reg.update(); }
      }
      location.reload();
    } catch (e) { /* senza rete non si aggiorna: l'app funziona lo stesso */ }
  }

  window.controllaVersione = controllaVersione;
  controllaVersione();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') controllaVersione();
  });
})();
