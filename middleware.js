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
    "/((?!api/|catalogues/|estimation\\.html|estimation-anc\\.html|pub-choix\\.html|details-projet\\.html|signature-devis\\.html|devis-manuel\\.html|confidentialite\\.html|assets/|favicon|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|css|js|ico)$).*)",
    // Protège spécifiquement ces routes admin, même si elles sont sous /api/.
    "/api/leads-admin",
    "/api/leads-anc-en-attente",
    "/api/valider-estimation-anc",
    "/api/dashboard-data",
    "/api/radar/dashboard",
  ],
};
// --- Connexion par page + cookie (ajouté le 19/11/2026) -------------------
// Sur iPhone, une appli installée sur l'écran d'accueil (PWA) ne sait PAS
// afficher la fenêtre de mot de passe "Basic" du navigateur : l'écran restait
// noir. On affiche donc une vraie page de connexion ; une fois le mot de passe
// validé, un cookie (valable 1 an) garde la session ouverte. L'ancienne
// authentification Basic reste acceptée si le navigateur l'envoie encore.
const COOKIE_NAME = "sf_session";

async function sessionToken(user, password) {
  const data = new TextEncoder().encode(`${user}:${password}:salesflow-session`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/mobile";
}

function loginPage(next, erreur) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#2e7d32">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Connexion — SalesFlow</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f7f4;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1b1b1b}
form{background:#fff;width:min(340px,88vw);padding:28px 24px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
img{display:block;width:140px;margin:0 auto 16px}
h1{font-size:20px;text-align:center;margin:0 0 20px}
label{display:block;font-size:14px;margin:12px 0 6px}
input{width:100%;box-sizing:border-box;font-size:17px;padding:12px;border:1px solid #ccc;border-radius:10px}
button{width:100%;margin-top:20px;padding:14px;font-size:17px;font-weight:600;color:#fff;background:#2e7d32;border:0;border-radius:10px}
.err{color:#c62828;font-size:14px;text-align:center;margin:0 0 8px}
.mdp{position:relative}
.mdp input{padding-right:52px}
.oeil{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:44px;height:44px;margin:0;padding:0;background:none;border:0;font-size:22px;line-height:1;cursor:pointer}
</style></head><body>
<form method="post" action="/connexion">
<img src="/icon-192.png" alt="EcoSky">
<h1>SalesFlow</h1>
${erreur ? `<p class="err">${esc(erreur)}</p>` : ""}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Identifiant</label>
<input id="u" name="user" autocomplete="username" autocapitalize="none" required>
<label for="p">Mot de passe</label>
<div class="mdp"><input id="p" name="password" type="password" autocomplete="current-password" required><button type="button" class="oeil" id="oeil" aria-label="Afficher le mot de passe">👁️</button></div>
<button type="submit">Se connecter</button>
</form>
<script>
document.getElementById("oeil").addEventListener("click",function(){var p=document.getElementById("p");var v=p.type==="password";p.type=v?"text":"password";this.textContent=v?"🙈":"👁️";this.setAttribute("aria-label",v?"Masquer le mot de passe":"Afficher le mot de passe");});
</script></body></html>`;
  return new Response(html, { status: erreur ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  // 25/11/2026 : on retire les espaces / retours à la ligne collés par erreur
  // dans les réglages Vercel, et l'identifiant ne tient plus compte des majuscules.
  const expectedUser = String(process.env.DASHBOARD_USER || "cyrille").trim().toLowerCase();
  const expectedPassword = process.env.DASHBOARD_PASSWORD ? String(process.env.DASHBOARD_PASSWORD).trim() : "";
  if (!expectedPassword) {
    // Si le mot de passe n'est pas configuré, on laisse passer plutôt que de
    // bloquer tout le monde par erreur — mais il FAUT le configurer.
    return;
  }
  const goodToken = await sessionToken(expectedUser, expectedPassword);

  // Envoi du formulaire de connexion
  if (url.pathname === "/connexion" && request.method === "POST") {
    let user = "", password = "", next = "/mobile";
    try {
      const form = await request.formData();
      user = String(form.get("user") || "").trim().toLowerCase();
      password = String(form.get("password") || "").trim();
      next = safeNext(form.get("next"));
    } catch (e) {}
    if (user === expectedUser && password === expectedPassword) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          "Set-Cookie": `${COOKIE_NAME}=${goodToken}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return loginPage(next, "Identifiant ou mot de passe incorrect.");
  }

  // Déconnexion
  if (url.pathname === "/deconnexion") {
    return new Response(null, {
      status: 303,
      headers: { Location: "/connexion", "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  // Session déjà ouverte (cookie)
  if (readCookie(request, COOKIE_NAME) === goodToken) {
    if (url.pathname === "/connexion") return Response.redirect(new URL("/mobile", url), 303);
    return; // accès autorisé
  }

  // Ancienne méthode (Basic) toujours acceptée
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const [user, ...rest] = atob(authHeader.slice(6)).split(":");
      if (user.trim().toLowerCase() === expectedUser && rest.join(":").trim() === expectedPassword) return;
    } catch (e) {}
  }

  // Non connecté : page de connexion pour les pages, 401 simple pour l'API
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/radar/dashboard") {
    return new Response(JSON.stringify({ error: "Authentification requise." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const next = url.pathname === "/connexion" ? safeNext(url.searchParams.get("next")) : url.pathname + url.search;
  return loginPage(next, null);
}
