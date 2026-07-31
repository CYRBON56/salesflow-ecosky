// api/sms-nouveau-clic.js
// Envoie un SMS immédiat à Cyrille dès qu'un visiteur arrive sur la page
// du formulaire en venant d'une publicité Meta (présence de fbclid).
// Ne remplace pas les autres SMS (devis complété, rappel demandé) — c'est
// un signal précoce en plus, avant même que le visiteur remplisse quoi que ce soit.
//
// N'utilise pas le package npm "twilio" (non installé sur ce projet) —
// appelle directement l'API REST Twilio via fetch, comme les autres
// endpoints SMS du projet.

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

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const toNumber = process.env.TWILIO_TO_NUMBER;

    const message = `🔔 Nouveau clic pub EcoSky !\nQuelqu'un vient d'ouvrir le formulaire devis via la pub Meta${utm_campaign ? ` (${utm_campaign})` : ''}.\nPage : ${page || 'estimation.html'}`;

    const body = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Body: message,
    });

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: body.toString(),
      }
    );

    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      console.error('Erreur Twilio (sms-nouveau-clic):', twilioRes.status, errText);
      return res.status(200).json({ sent: false, error: errText });
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Erreur envoi SMS nouveau clic:', err);
    // On ne fait jamais échouer le chargement de la page à cause d'une erreur SMS
    return res.status(200).json({ sent: false, error: err.message });
  }
}
