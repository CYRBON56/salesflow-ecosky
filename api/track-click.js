// api/track-click.js
// Enregistre chaque arrivée sur le site depuis une pub Facebook (ou autre source
// trackée), même si la personne ne finit jamais par discuter avec Skyeco.
// Appelé automatiquement par le widget de chat au chargement de la page.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=minimal",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  // On répond toujours OK côté CORS pour que le widget (appelé depuis
  // ecoskybyrms.fr, un domaine différent de Vercel) puisse l'appeler.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const {
      session_id,
      fbclid,
      ad_id,
      utm_source,
      utm_campaign,
      utm_medium,
      landing_page,
      referrer,
    } = req.body || {};

    await supabaseRequest("web_clicks", {
      method: "POST",
      body: JSON.stringify({
        session_id: session_id || null,
        fbclid: fbclid || null,
        ad_id: ad_id || null,
        utm_source: utm_source || null,
        utm_campaign: utm_campaign || null,
        utm_medium: utm_medium || null,
        landing_page: landing_page || null,
        referrer: referrer || null,
      }),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("track-click error:", err.message);
    // On ne bloque jamais le visiteur pour un souci de tracking
    return res.status(200).json({ success: false });
  }
}
