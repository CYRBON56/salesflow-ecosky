// api/sms-nouveau-clic.js
// Envoie un SMS immédiat à Cyrille dès qu'un visiteur arrive sur la page
// du formulaire en venant d'une publicité Meta (présence de fbclid).
// Ne remplace pas les autres SMS (devis complété, rappel demandé) — c'est
// un signal précoce en plus, avant même que le visiteur remplisse quoi que ce soit.

import twilio from 'twilio';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fbclid, utm_source, utm_campaign, page } = req.body || {};

    // On n'envoie le SMS que si la visite vient bien d'une pub (fbclid présent)
    if (!fbclid) {
      return res.status(200).json({ skipped: true, reason: 'no fbclid' });
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const message = `🔔 Nouveau clic pub EcoSky !\nQuelqu'un vient d'ouvrir le formulaire devis via la pub Meta${utm_campaign ? ` (${utm_campaign})` : ''}.\nPage : ${page || 'estimation.html'}`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.TWILIO_TO_NUMBER,
    });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Erreur envoi SMS nouveau clic:', err);
    // On ne fait jamais échouer le chargement de la page à cause d'une erreur SMS
    return res.status(200).json({ sent: false, error: err.message });
  }
}
