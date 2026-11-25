// api/carrousel.js (25/11/2026) — Skyeco Posts, dans Skyeco Admin.
// Lit la page d'une appli Skyeco et fait écrire par l'IA un carrousel TikTok
// de 5 diapos (accroche, problème, solution, preuve, appel à l'action),
// avec la légende et les hashtags. Les images sont dessinées dans la page
// /carrousel.html. Route protégée par la connexion (middleware.js).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODELE = "claude-sonnet-5-5";

export const APPLIS = {
  "mon-assistant-pro": {
    nom: "Mon Assistant Pro",
    url: "https://www.skyeco.fr/mon-assistant-pro/",
    cta: "7 jours gratuits, sans carte bancaire",
    lien: "skyeco.fr/mon-assistant-pro",
  },
};

const ANGLES = [
  "le temps perdu le soir et le week-end sur la paperasse (devis, factures, mails)",
  "les devis faits à la voix depuis le chantier, envoyés le jour même",
  "les relances de devis et d'impayés qui se font toutes seules",
  "les appels manqués pendant qu'on est sur le chantier (secrétaire téléphonique)",
  "le prix comparé à une secrétaire à mi-temps",
  "le test réel chez RMS EcoSky (devis signés en ligne, certains le jour même)",
  "les réseaux sociaux et les avis Google qu'on n'a jamais le temps de gérer",
];

function texteDePage(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 9000);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST uniquement" });
  const { appli = "mon-assistant-pro", angle, deja = [] } = req.body || {};
  const a = APPLIS[appli];
  if (!a) return res.status(400).json({ error: "Appli inconnue" });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Clé IA absente" });

  let page = "";
  try {
    const r = await fetch(a.url, { headers: { "User-Agent": "SkyecoCarrousel/1.0" } });
    page = texteDePage(await r.text());
  } catch (e) {
    return res.status(502).json({ error: "Page de l'appli illisible" });
  }

  const angleChoisi = angle || ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const consignes = `Tu écris un carrousel TikTok de 5 diapos, en français, pour vendre « ${a.nom} » à des artisans du bâtiment et des patrons de petites entreprises en France.

Angle de ce carrousel : ${angleChoisi}.
${deja.length ? `Accroches déjà utilisées, à ne pas reprendre : ${deja.slice(-10).map((x) => `« ${x} »`).join(", ")}.` : ""}

Contenu de la page de l'appli (seule source autorisée pour les faits, prix et chiffres) :
"""${page}"""

Règles :
- Diapo 1 : une accroche qui arrête le pouce, 9 mots maximum, qui parle d'une douleur concrète de l'artisan. Pas de nom d'appli sur cette diapo.
- Diapo 2 : le problème, vécu, concret (soir, week-end, chantier, téléphone qui sonne).
- Diapo 3 : la solution : ce que fait ${a.nom}, en clair.
- Diapo 4 : une preuve ou un chiffre tiré UNIQUEMENT de la page (prix, test chez RMS EcoSky, 15 minutes…). N'invente rien.
- Diapo 5 : l'appel à l'action : « ${a.cta} » et le lien ${a.lien}.
- Chaque diapo : un "titre" de 9 mots maximum et un "texte" de 25 mots maximum (peut être vide sur la diapo 1). Vouvoiement. Ton direct, d'artisan à artisan, sans jargon marketing ni anglicismes. Pas d'emoji dans les titres ; 1 emoji maximum dans un texte.
- "legende" : la légende TikTok, 2 à 3 phrases, qui finit par le lien ${a.lien}.
- "hashtags" : 5 à 7 hashtags français pertinents (artisan, BTP…), sans le #.

Réponds UNIQUEMENT avec ce JSON, sans rien autour :
{"slides":[{"titre":"…","texte":"…"},{"titre":"…","texte":"…"},{"titre":"…","texte":"…"},{"titre":"…","texte":"…"},{"titre":"…","texte":"…"}],"legende":"…","hashtags":["…"]}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELE, max_tokens: 1200, messages: [{ role: "user", content: consignes }] }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "IA : " + (j.error && j.error.message || r.status) });
    const brut = (j.content || []).map((c) => c.text || "").join("");
    const m = brut.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : brut);
    if (!Array.isArray(data.slides) || data.slides.length !== 5) throw new Error("format");
    return res.status(200).json({ appli: a.nom, lien: a.lien, angle: angleChoisi, ...data });
  } catch (e) {
    return res.status(502).json({ error: "Le carrousel n'a pas pu être écrit, réessaie." });
  }
}
