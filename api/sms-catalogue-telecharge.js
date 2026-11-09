// api/sms-catalogue-telecharge.js
// Envoie un SMS à TWILIO_TO_NUMBER dès qu'un visiteur clique sur le bouton
// "Télécharger le catalogue" — reprend le même pattern Twilio que
// api/sms-nouveau-clic.js et api/track-click.js déjà en place sur ce repo.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { page } = req.body || {};

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const toNumber = process.env.TWILIO_TO_NUMBER;

    if (!accountSid || !authToken || !fromNumber || !toNumber) {
      // On ne bloque jamais le visiteur pour un souci de config SMS.
      return res.status(200).json({ success: false, error: "Twilio non configuré" });
    }

    const client = twilio(accountSid, authToken);

    // Géolocalisation approximative via les en-têtes Vercel, même logique
    // que pour les SMS de clic pub (pas de GPS précis, juste indicatif).
    const city = req.headers["x-vercel-ip-city"]
      ? decodeURIComponent(req.headers["x-vercel-ip-city"])
      : null;
    const region = req.headers["x-vercel-ip-region"] || null;

    const now = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    const lieu = city ? ` (${city}${region ? ", " + region : ""})` : "";
    const pageLabel = page || "page inconnue";

    const body = `📄 Catalogue EcoSky'Gum téléchargé — ${now}${lieu} — depuis ${pageLabel}`;

    await client.messages.create({
      body,
      from: fromNumber,
      to: toNumber,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur SMS catalogue:", err);
    // On répond quand même success:false sans casser l'expérience visiteur.
    return res.status(200).json({ success: false, error: "Erreur envoi SMS" });
  }
}
