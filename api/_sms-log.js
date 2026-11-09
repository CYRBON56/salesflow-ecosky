// api/_sms-log.js
// Utilitaire partagé : enregistre chaque SMS envoyé (ou tenté) dans la table
// Supabase sms_log, pour qu'ils apparaissent dans la page /sms-recus.html de
// SalesFlow System. Importé par toutes les fonctions qui envoient un SMS.
// N'échoue jamais bruyamment : un souci d'écriture ne doit jamais empêcher
// l'envoi du SMS lui-même ni la réponse au visiteur.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function logSms({
  sms_type,
  destinataire = null,
  source = null,
  utm_campaign = null,
  geo_city = null,
  geo_region = null,
  geo_country = null,
  message_body = null,
  twilio_success = null,
}) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
    await fetch(`${SUPABASE_URL}/rest/v1/sms_log`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        sms_type,
        destinataire,
        source,
        utm_campaign,
        geo_city,
        geo_region,
        geo_country,
        message_body,
        twilio_success,
      }),
    });
  } catch (err) {
    console.error("logSms error:", err.message);
  }
}
