// api/sms-nouveau-clic.js
// Envoie un SMS immédiat à Cyrille dès qu'un visiteur arrive sur la page
// du formulaire en venant d'une publicité Meta (présence de fbclid).
// Ne remplace pas les autres SMS (devis complété, rappel demandé) — c'est
// un signal précoce en plus, avant même que le visiteur remplisse quoi que ce soit.
//
// N'utilise pas le package npm "twilio" (non installé sur ce projet) —
// appelle directement l'API REST Twilio via fetch.
//
// Indique aussi si le visiteur semble déjà être venu avant (via son
// session_id stocké côté navigateur, comparé aux clics précédents dans
// Supabase — table web_clicks) et sa localisation approximative (déduite
// de son IP par Vercel, aucun service externe nécessaire).
//
// IMPORTANT : vérifier que les noms des variables d'environnement
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY ci-dessous correspondent bien
// à ceux déjà utilisés par les autres fichiers api/ de ce projet (submit-
// estimation.js, etc.) — les adapter si les noms diffèrent sur Vercel.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fbclid, utm_source, utm_campaign, page, session_id } = req.body || {};

    // On n'envoie le SMS que si la visite vient bien d'une pub (fbclid présent)
    if (!fbclid) {
      return res.status(200).json({ skipped: true, reason: 'no fbclid' });
    }

    // ---------- Localisation approximative (headers Vercel) ----------
    const city = req.headers['x-vercel-ip-city']
      ? decodeURIComponent(req.headers['x-vercel-ip-city'])
      : null;
    const region = req.headers['x-vercel-ip-country-region'] || null;
    const country = req.headers['x-vercel-ip-country'] || null;
    const locationParts = [city, region, country].filter(Boolean);
    const locationStr = locationParts.length > 0 ? locationParts.join(', ') : 'localisation inconnue';

    // ---------- Nouveau visiteur ou déjà venu ? ----------
    let visitorStatus = '🆕 Nouveau visiteur';
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      if (session_id && supabaseUrl && supabaseKey) {
        const checkRes = await fetch(
          `${supabaseUrl}/rest/v1/web_clicks?session_id=eq.${encodeURIComponent(session_id)}&fbclid=neq.${encodeURIComponent(fbclid)}&select=id&limit=1`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          }
        );
        if (checkRes.ok) {
          const rows = await checkRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            visitorStatus = '🔁 Déjà venu(e) via une pub précédemment';
          }
        }
      }
    } catch (checkErr) {
      console.error('Erreur vérification visiteur déjà venu:', checkErr);
      // On continue avec "Nouveau visiteur" par défaut plutôt que d'échouer
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const toNumber = process.env.TWILIO_TO_NUMBER;

    const message =
      `🔔 Nouveau clic pub EcoSky !\n` +
      `${visitorStatus}\n` +
      `📍 ${locationStr}\n` +
      `Pub${utm_campaign ? ` : ${utm_campaign}` : ''}\n` +
      `Page : ${page || 'estimation.html'}`;

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
