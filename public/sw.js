// Service worker minimal pour rendre SalesFlow installable (PWA).
// Volontairement SANS cache ni interception des requêtes : le dashboard est
// protégé par mot de passe (middleware.js) et doit toujours afficher des
// données à jour, donc tout passe directement par le réseau.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
