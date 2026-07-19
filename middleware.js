// middleware.js (à la racine du repo, PAS dans le dossier api/)
// Protège l'accès au dashboard SalesFlow System par un identifiant/mot de
// passe (authentification HTTP Basic), pour que seuls toi et ton équipe
// puissiez le consulter. Le formulaire d'estimation (estimation.html) et
// la plupart des routes API (/api/*) restent librement accessibles, car ce
// sont tes clients qui doivent pouvoir les utiliser sans mot de passe.
// EXCEPTION : /api/leads-admin regroupe les actions sensibles (modifier/
// supprimer un lead, importer un CSV, changer les réglages) et reste
// protégée par le même mot de passe — un navigateur qui s'est déjà
// authentifié pour la page renvoie automatiquement les mêmes identifiants
// sur ces appels, donc rien à faire côté dashboard.

export const config = {
  matcher: [
    // Protège tout SAUF : /api/* (hors leads-admin), /estimation.html, les
    // fichiers statiques (images, css, js compilés par Vite), et les routes
    // internes Next/Vercel.
    "/((?!api/|estimation\\.html|assets/|favicon|.*\\.(?:png|jpg|jpeg|svg|css|js|ico)$).*)",
    // Protège spécifiquement cette route admin, même si elle est sous /api/.
    "/api/leads-admin",
  ],
};

export default function middleware(request) {
  const authHeader = request.headers.get("authorization");

  const expectedUser = process.env.DASHBOARD_USER || "cyrille";
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedPassword) {
    // Si le mot de passe n'est pas configuré, on laisse passer plutôt que de
    // bloquer tout le monde par erreur — mais il FAUT le configurer (voir
    // instructions ci-dessous).
    return;
  }

  if (authHeader) {
    const base64Credentials = authHeader.split(" ")[1] || "";
    const credentials = atob(base64Credentials);
    const [user, password] = credentials.split(":");
    if (user === expectedUser && password === expectedPassword) {
      return; // accès autorisé
    }
  }

  return new Response("Authentification requise.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SalesFlow System"',
    },
  });
}
