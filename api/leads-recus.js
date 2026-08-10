// api/leads-recus.js
// Retourne l'historique des demandes d'estimation (table leads), pour la
// page /sms-recus.html de SalesFlow System. Lecture seule, protégée par le
// même middleware que le reste du dashboard.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const colonnes = [
      "id", "created_at", "nom", "prenom", "telephone", "email",
      "adresse_projet", "code_postal", "surface_m2", "type_projet",
      "delai_souhaite", "source", "statut", "formulaire_complete",
      "callback_demande", "estimation_numero", "estimation_pdf_url",
    ].join(",");
    const url =
      `${SUPABASE_URL}/rest/v1/leads?select=${colonnes}&order=created_at.desc&limit=${limit}`;
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
    console.error("leads-recus error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors de la récupération des demandes" });
  }
}
