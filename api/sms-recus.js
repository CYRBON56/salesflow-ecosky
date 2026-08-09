// api/sms-recus.js
// Retourne l'historique des SMS envoyés (table sms_log), pour la page
// /sms-recus.html de SalesFlow System. Lecture seule (GET), protégée par le
// même middleware que le reste du dashboard (pas dans la liste des pages
// publiques exemptées). Supporte aussi la suppression (DELETE ?id=... ou
// DELETE ?ids=1,2,3) pour retirer les SMS non pertinents de la liste.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "DELETE") {
    try {
      const idsParam = req.query.ids || req.query.id;
      if (!idsParam) {
        return res.status(400).json({ ok: false, error: "Paramètre id ou ids requis" });
      }
      const ids = String(idsParam)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n));
      if (!ids.length) {
        return res.status(400).json({ ok: false, error: "Aucun identifiant valide" });
      }
      const filtre = `id=in.(${ids.join(",")})`;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_log?${filtre}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: "return=minimal",
        },
      });
      if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
      return res.status(200).json({ ok: true, deleted: ids.length });
    } catch (err) {
      console.error("sms-recus DELETE error:", err.message);
      return res.status(500).json({ ok: false, error: "Erreur lors de la suppression" });
    }
  }

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
