// api/devis-signes.js
// GET /api/devis-signes
//
// Retourne la liste de tous les devis au statut "signe", triés du plus
// récent au plus ancien, pour l'onglet "Devis signés" du dashboard.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }
  try {
    const colonnes = [
      "id",
      "numero",
      "nom_client",
      "montant_ttc",
      "type_projet",
      "date_signature",
      "nom_signataire",
      "pdf_signe_url",
    ].join(",");
    const rows = await supabaseRequest(
      `devis?select=${colonnes}&statut=eq.signe&order=date_signature.desc`,
      { prefer: "return=representation" }
    );
    return res.status(200).json({ ok: true, rows: rows || [] });
  } catch (err) {
    console.error("devis-signes error:", err.message);
    return res
      .status(500)
      .json({ ok: false, error: "Erreur lors de la récupération des devis signés" });
  }
}
