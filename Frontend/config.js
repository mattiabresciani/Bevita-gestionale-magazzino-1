// ── CONFIGURAZIONE BACKEND ────────────────────────────────────────────────────
// UNICO punto in cui si imposta l'URL del backend. Cambia qui la porta per
// puntare al backend desiderato:
//   5001 = backend Python (Flask)
//   5002 = backend PHP (Slim 4)
// Tutto il resto del frontend (script.js, framework.js, login.html, user.html)
// legge questo valore tramite window.BACKEND_URL.
window.BACKEND_URL = 'http://' + location.hostname + ':5002';
