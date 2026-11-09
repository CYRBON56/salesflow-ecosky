// api/dashboard-data.js
// Toutes les LECTURES du dashboard (leads, réglages, clics pub, conversations
// WhatsApp) passent désormais par ici, avec la clé service_role côté serveur.
// Avant, le navigateur lisait ces tables directement avec la clé publique
// Supabase, visible dans le code du site : n'importe qui pouvait donc lire
// les données clients. Cette route est protégée par le mot de passe du
// dashboard (voir middleware.js) et refuse de répondre si ce mot de passe
// n'est pas configuré.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
}

const safe = (p) => p.catch(() => []);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  if (!process.env.DASHBOARD_PASSWORD) {
    return res.status(503).json({ error: "DASHBOARD_PASSWORD non configuré sur Vercel." });
  }
  res.setHeader("Cache-Control", "no-store");
  const view = req.query.view || "main";

  try {
    if (view === "main") {
      const [leads, settings, clicks] = await Promise.all([
        sb("leads?select=*&order=created_at.desc"),
        safe(sb("settings?select=*&id=eq.1")),
        safe(sb("web_clicks?select=*&order=created_at.desc&limit=200")),
      ]);
      return res.status(200).json({ leads, settings: settings[0] || null, clicks });
    }

    if (view === "mobile") {
      const nowIso = encodeURIComponent(new Date().toISOString());
      const [clicks, devis, callbacks, rdv] = await Promise.all([
        sb("web_clicks?select=*&order=created_at.desc&limit=50"),
        sb("leads?select=*&estimation_pdf_url=not.is.null&order=created_at.desc&limit=30"),
        sb("leads?select=*&callback_demande=eq.true&order=callback_demande_le.desc"),
        sb(`leads?select=*&rdv_date=not.is.null&rdv_date=gte.${nowIso}&order=rdv_date.asc`),
      ]);
      return res.status(200).json({ clicks, devis, callbacks, rdv });
    }

    if (view === "whatsapp") {
      const phone = encodeURIComponent(String(req.query.phone || ""));
      if (!phone) return res.status(400).json({ error: "phone requis" });
      const [conv, messages] = await Promise.all([
        sb(`wa_conversations?select=*&phone=eq.${phone}&limit=1`),
        sb(`wa_messages?select=*&phone=eq.${phone}&order=created_at.asc`),
      ]);
      return res.status(200).json({ conversation: conv[0] || null, messages });
    }

    return res.status(400).json({ error: "view inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur de lecture" });
  }
}
