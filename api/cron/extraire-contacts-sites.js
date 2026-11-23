// api/cron/extraire-contacts-sites.js
//
// Relève le mail et le téléphone affichés sur le site internet de chaque
// entreprise du bâtiment de prospects_construction (page d'accueil, puis
// pages "contact" et "mentions légales" trouvées dans les liens).
// Résultat stocké dans prospects_construction :
//   site_emails, site_telephones (séparés par ";"), site_joignable,
//   contacts_site_verifie_le (date du passage — une seule visite par site).
//
// Fonctionne par lots de ~50 s, puis se relance tout seul (appel à lui-même)
// tant qu'il reste des sites à visiter : un seul déclenchement (cron de nuit)
// suffit à parcourir les ~16 000 sites en quelques heures.

import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const USER_AGENT = "Mozilla/5.0 (compatible; EcoSkyBot/1.0; +https://skyeco.fr/a-propos-bot)";
const PARALLELE = 12;
const LOT = 150;
const BUDGET_MS = 45000;
const TIMEOUT_PAGE = 7000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,10}/gi;
const TEL_RE = /(?:\+33\s?\(?0?\)?\s?|0)[1-9](?:[\s.\-]?\d{2}){4}/g;
const EMAIL_EXCLUS = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|exemple|domain|domaine|sentry|wixpress|sentry-next)\.|^(nom|votre|your|name|email|e-mail|prenom)@|@2x/i;

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const debut = Date.now();
  const stats = { visites: 0, avec_email: 0, avec_tel: 0, injoignables: 0 };

  const { data: lot, error } = await supabase
    .from("prospects_construction")
    .select("siren, site_web, ml_site")
    .or("site_web.not.is.null,ml_site.not.is.null")
    .is("contacts_site_verifie_le", null)
    .order("siren", { ascending: true })
    .limit(LOT);
  if (error) return res.status(500).json({ error: error.message });

  const file = [...(lot || [])];
  const travailleur = async () => {
    while (file.length && Date.now() - debut < BUDGET_MS) {
      const p = file.shift();
      const site = premierSite(p.site_web, p.ml_site);
      let r = { emails: [], tels: [], joignable: false };
      if (site) {
        try { r = await extraireContacts(site); } catch { /* site injoignable */ }
      }
      await supabase
        .from("prospects_construction")
        .update({
          site_emails: r.emails.join(";") || null,
          site_telephones: r.tels.join(";") || null,
          site_joignable: r.joignable,
          contacts_site_verifie_le: new Date().toISOString(),
        })
        .eq("siren", p.siren);
      stats.visites++;
      if (r.emails.length) stats.avec_email++;
      if (r.tels.length) stats.avec_tel++;
      if (!r.joignable) stats.injoignables++;
    }
  };
  await Promise.all(Array.from({ length: PARALLELE }, travailleur));

  // Il reste des sites ? On relance un nouveau lot (sans attendre sa fin).
  const resteDesSites = (lot || []).length === LOT || file.length > 0;
  if (resteDesSites && req.query.suite !== "non") {
    try {
      await fetch(`https://${req.headers.host}/api/cron/extraire-contacts-sites`, {
        headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
        signal: AbortSignal.timeout(1500),
      });
    } catch { /* normal : on n'attend pas la réponse */ }
  }

  return res.status(200).json({ ...stats, relance: resteDesSites, duree_s: Math.round((Date.now() - debut) / 1000) });
}

function premierSite(siteWeb, mlSite) {
  const brut = (siteWeb && siteWeb.trim()) || (mlSite && mlSite.trim());
  if (!brut) return null;
  return brut.split(/[;,\s]/)[0].trim() || null;
}

async function charger(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_PAGE),
  });
  const type = r.headers.get("content-type") || "";
  if (!r.ok || (type && !type.includes("html"))) return { html: "", url: r.url };
  const html = (await r.text()).slice(0, 600000);
  return { html, url: r.url };
}

async function extraireContacts(site) {
  const base = site.startsWith("http") ? site : `https://${site}`;
  let accueil;
  try { accueil = await charger(base); }
  catch { accueil = await charger(base.replace("https://", "http://")); }

  const emails = new Set();
  const tels = new Set();
  analyser(accueil.html, emails, tels);

  // Pages contact / mentions légales trouvées dans les liens de l'accueil
  const liens = [...accueil.html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => /contact|mention|legal|nous-joindre|coordonn|a-propos|qui-sommes/i.test(h))
    .slice(0, 3);
  for (const h of liens) {
    try {
      const u = new URL(h, accueil.url || base).href;
      if (!u.startsWith("http")) continue;
      const page = await charger(u);
      analyser(page.html, emails, tels);
    } catch { /* page secondaire injoignable */ }
  }

  // Priorité aux adresses du même domaine que le site
  const domaine = (() => { try { return new URL(accueil.url || base).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const tri = [...emails].sort((a, b) => (b.endsWith(domaine) ? 1 : 0) - (a.endsWith(domaine) ? 1 : 0));

  return { emails: tri.slice(0, 5), tels: [...tels].slice(0, 3), joignable: !!accueil.html };
}

function analyser(html, emails, tels) {
  if (!html) return;
  const texte = html
    .replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@")
    .replace(/%40/g, "@");
  for (const m of texte.match(EMAIL_RE) || []) {
    const e = m.toLowerCase().replace(/^mailto:/, "").replace(/\.$/, "");
    if (!EMAIL_EXCLUS.test(e)) emails.add(e);
  }
  for (const m of texte.match(TEL_RE) || []) {
    const chiffres = m.replace(/\D/g, "").replace(/^330?/, "0");
    if (chiffres.length === 10 && !/^0(\d)\1{8}$/.test(chiffres)) tels.add(chiffres.replace(/(\d{2})(?=\d)/g, "$1 "));
  }
}
