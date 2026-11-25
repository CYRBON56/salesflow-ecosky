// Réglage ponctuel (25/11/2026) : branche les SMS entrants du numéro Twilio
// du système sur /api/sms-entrant. À supprimer après usage.
export default async function handler(req, res) {
  const SID = process.env.TWILIO_ACCOUNT_SID, TOK = process.env.TWILIO_AUTH_TOKEN, FROM = process.env.TWILIO_FROM_NUMBER;
  const auth = "Basic " + Buffer.from(`${SID}:${TOK}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;
  const l = await (await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(FROM)}`, { headers: { Authorization: auth } })).json();
  const n = (l.incoming_phone_numbers || [])[0];
  if (!n) return res.status(200).json({ ok: false, err: "numéro introuvable", from_type: /^\+/.test(FROM || "") ? "numero" : "alphanumerique" });
  const avant = { sms_url: n.sms_url, sms_application_sid: n.sms_application_sid, messaging_service_sid: n.messaging_service_sid || null, capabilities: n.capabilities };
  if (req.query.appliquer !== "1") return res.status(200).json({ ok: true, avant });
  const r = await fetch(`${base}/IncomingPhoneNumbers/${n.sid}.json`, {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SmsUrl: "https://salesflow-ecosky.vercel.app/api/sms-entrant", SmsMethod: "POST" }).toString(),
  });
  const d = await r.json();
  res.status(200).json({ ok: r.ok, avant, apres: { sms_url: d.sms_url }, err: d.message });
}
