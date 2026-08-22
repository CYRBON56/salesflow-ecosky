// middleware.js (à la racine du repo, PAS dans le dossier api/)
// Protège l'accès au dashboard SalesFlow System par un identifiant/mot de
// passe (authentification HTTP Basic), pour que seuls toi et ton équipe
// puissiez le consulter. Les formulaires d'estimation (estimation.html et
// estimation-anc.html), pub-choix.html (page de choix affichée aux visiteurs
// venant d'une pub), details-projet.html (formulaire léger envoyé par SMS
// après l'appel de RDV pour compléter nom/adresse/photos), signature-devis.html
// (signature électronique des devis, ouverte par les clients depuis le lien
// SMS/email), devis-manuel.html (création de devis pour un client hors base)
// et la plupart des routes API (/api/*) restent librement accessibles, car ce
// sont tes clients qui doivent pouvoir les utiliser sans mot de passe.
// EXCEPTIONS protégées malgré tout (actions/données sensibles côté admin) :
//   - /api/leads-admin : modifier/supprimer un lead, importer un CSV, réglages
//   - /api/leads-anc-en-attente : liste les demandes ANC avec données clients
//   - /api/valider-estimation-anc : envoie le devis définitif ANC au client
// Un navigateur déjà authentifié pour la page valider-anc.html renvoie
// automatiquement les mêmes identifiants sur ces appels, donc rien à faire
// côté page — la protection est transparente pour toi.
export const config = {
  matcher: [
    // Protège tout SAUF : /api/* (hors les 3 routes listées ci-dessous),
    // /estimation.html, /estimation-anc.html, /pub-choix.html,
    // /details-projet.html, /signature-devis.html, /devis-manuel.html,
    // les fichiers statiques (images, css, js compilés par Vite), et les
    // routes internes Next/Vercel.
    "/((?!api/|estimation\\.html|estimation-anc\\.html|pub-choix\\.html|details-projet\\.html|signature-devis\\.html|devis-manuel\\.html|assets/|favicon|.*\\.(?:png|jpg|jpeg|svg|css|js|ico)$).*)",
    // Protège spécifiquement ces routes admin, même si elles sont sous /api/.
    "/api/leads-admin",
    "/api/leads-anc-en-attente",
    "/api/valider-estimation-anc",
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
