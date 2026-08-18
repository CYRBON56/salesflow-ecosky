// api/_sms.js
// Utilitaire d'envoi de SMS via Twilio — volontairement conservé, à la
// différence des autres notifications (désormais par email), pour un seul
// usage : le SMS envoyé au client juste après réception de son estimation
// détaillée, lui demandant l'adresse exacte du chantier et un lien pour
// envoyer des photos.

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export async function sendSms(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) {
    console.error("Twilio: configuration manquante ou numéro absent, SMS non envoyé.");
    return false;
  }
  try {
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    if (!res.ok) {
      console.error("Twilio SMS error:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendSms error:", err.message);
    return false;
  }
}
