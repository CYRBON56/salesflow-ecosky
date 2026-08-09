// api/sms-recus.js
// Retourne l'historique des SMS envoyés (table sms_log), pour la page
// /sms-recus.html de SalesFlow System. Lecture seule, protégée par le
// même middleware que le reste du dashboard (pas dans la liste des pages
// publiques exemptées).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const url =
      `${SUPABASE_URL}/rest/v1/sms_log?select=*&order=created_at.desc&limit=${limit}`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    return res.status(200).json({ ok: true, rows });
  } catch (err) {
    console.error("sms-recus error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors de la récupération des SMS" });
  }
}
