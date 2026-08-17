// api/verify-check-code.js
// Vérifie le code saisi par le client via Twilio Verify.
// Nécessite les variables d'environnement Vercel :
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+33${digits.slice(1)}`;
  if (digits.length === 9) return `+33${digits}`;
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { telephone, code } = req.body || {};
    const phone = normalizePhone(telephone);
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: "Numéro ou code manquant." });
    }

    const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    const params = new URLSearchParams({ To: phone, Code: String(code).trim() });

    const twilioRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error("verify-check-code Twilio error:", data);
      return res.status(400).json({ success: false, error: "Code invalide ou expiré." });
    }

    const verified = data.status === "approved";
    if (!verified) {
      return res.status(400).json({ success: false, error: "Code incorrect. Réessayez." });
    }

    return res.status(200).json({ success: true, verified: true });
  } catch (err) {
    console.error("verify-check-code error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
