// api/lookup-lead-by-phone.js
// Recherche un lead existant par numéro de téléphone (E.164). Utilisé par
// estimation.html pour pré-remplir automatiquement nom/prénom/email dès
// qu'un visiteur retape son téléphone après être passé par le formulaire
// instantané Meta — sans dépendre d'un mécanisme de transfert d'URL qui
// n'existe pas côté Meta.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("33")) return "+" + digits;
  if (digits.startsWith("0")) return "+33" + digits.slice(1);
  return "+" + digits;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const phoneRaw = req.query.telephone;
    const phoneE164 = toE164(phoneRaw);
    if (!phoneE164 || phoneE164.length < 8) {
      return res.status(200).json({ found: false });
    }

    const url = `${SUPABASE_URL}/rest/v1/leads?telephone=eq.${encodeURIComponent(phoneE164)}&select=nom,prenom,email&limit=1`;
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
    });
  } catch (err) {
    console.error("lookup-lead-by-phone error:", err.message);
    return res.status(200).json({ found: false });
  }
}
