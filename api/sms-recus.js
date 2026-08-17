// api/sms-recus.js
// Retourne (GET) et supprime (DELETE) l'historique des SMS envoyés
// automatiquement (table sms_log), pour la page /sms-recus.html de
// SalesFlow System. Protégé par le même middleware Basic Auth que le
// reste du dashboard (voir middleware.js à la racine).
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
  try {
    if (req.method === "GET") {
      const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
      const colonnes = [
        "id",
        "created_at",
        "sms_type",
        "source",
        "utm_campaign",
        "geo_city",
        "geo_country",
        "twilio_success",
        "message_body",
      ].join(",");
      const rows = await supabaseRequest(
        `sms_log?select=${colonnes}&order=created_at.desc&limit=${limit}`,
        { prefer: "return=representation" }
      );
      return res.status(200).json({ ok: true, rows: rows || [] });
    }

    if (req.method === "DELETE") {
      const idsParam = req.query.ids;
      if (!idsParam) {
        return res.status(400).json({ ok: false, error: "ids requis." });
      }
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) {
        return res.status(400).json({ ok: false, error: "ids requis." });
      }
      await supabaseRequest(`sms_log?id=in.(${ids.join(",")})`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).send("Method not allowed");
  } catch (err) {
    console.error("sms-recus error:", err.message);
    return res
      .status(500)
      .json({ ok: false, error: "Erreur lors de la récupération/suppression des SMS" });
  }
}
