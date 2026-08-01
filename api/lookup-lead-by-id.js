// api/lookup-lead-by-id.js
// Recherche un lead existant par son id Supabase. Utilisé par estimation.html
// quand le visiteur arrive via le lien personnalisé envoyé par email
// (send-refine-devis-email.js) — permet un pré-remplissage complet et fiable,
// sans dépendre du visiteur qui retape son téléphone.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const leadId = req.query.lead_id;
    if (!leadId) {
      return res.status(200).json({ found: false });
    }

    const url = `${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=nom,prenom,email,telephone&limit=1`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!r.ok) return res.status(200).json({ found: false });

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ found: false });
    }

    const lead = rows[0];
    return res.status(200).json({
      found: true,
      nom: lead.nom || "",
      prenom: lead.prenom || "",
      email: lead.email || "",
      telephone: lead.telephone || "",
    });
  } catch (err) {
    console.error("lookup-lead-by-id error:", err.message);
    return res.status(200).json({ found: false });
  }
}
