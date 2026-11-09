// api/clics-pub.js
// GET /api/clics-pub
//
// Compte le nombre de clics publicitaires enregistrés dans web_clicks :
// une ligne est comptée comme "clic pub" si elle porte un identifiant
// Google Ads (gclid), Meta Ads (fbclid) ou un ad_id générique.
// Retourne aussi la répartition Google / Meta pour info.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Fait une requête HEAD-like (Range 0-0 + Prefer count=exact) pour récupérer
// uniquement le nombre total de lignes correspondant au filtre, sans
// télécharger les données elles-mêmes.
async function compter(filtre) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/web_clicks?select=id&${filtre}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  const contentRange = res.headers.get("content-range") || "";
  const total = parseInt(contentRange.split("/")[1], 10);
  return Number.isNaN(total) ? 0 : total;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }
  try {
    const [total, google, meta] = await Promise.all([
      compter("or=(gclid.not.is.null,fbclid.not.is.null,ad_id.not.is.null)"),
      compter("gclid=not.is.null"),
      compter("fbclid=not.is.null"),
    ]);
    return res.status(200).json({ ok: true, total, google, meta });
  } catch (err) {
    console.error("clics-pub error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors du comptage des clics publicitaires" });
  }
}
