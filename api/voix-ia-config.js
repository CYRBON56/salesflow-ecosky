// api/voix-ia-config.js
// Réglage de la secrétaire téléphonique IA (outil d'administration).
// Protégé par CRON_SECRET (en-tête Authorization: Bearer <CRON_SECRET>).
//   GET  : état du compte Twilio + liste des numéros Twilio et leur réglage vocal
//   POST : {"sid": "PN..."} → branche ce numéro sur /api/voix-ia
//          {"sid": "PN...", "couper": true} → débranche la secrétaire de ce numéro

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

async function twilio(path, options = {}) {
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}${path}`, {
    ...options,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ erreur: "non autorisé" });
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = `https://${host}`;

  if (req.method === "GET" && req.query && req.query.appels) {
    const r = await twilio("/Calls.json?PageSize=20");
    return res.status(200).json(
      (r.data.calls || []).map((c) => ({
        date: c.date_created,
        de: c.from,
        vers: c.to,
        renvoye_par: c.forwarded_from,
        statut: c.status,
        duree: c.duration,
        sens: c.direction,
      }))
    );
  }

  if (req.method === "GET") {
    const compte = await twilio(".json");
    const numeros = await twilio("/IncomingPhoneNumbers.json?PageSize=50");
    return res.status(200).json({
      compte: { ok: compte.ok, statut: compte.data.status, type: compte.data.type },
      numeros: (numeros.data.incoming_phone_numbers || []).map((n) => ({
        sid: n.sid,
        numero: n.phone_number,
        nom: n.friendly_name,
        voix: n.capabilities && n.capabilities.voice,
        sms: n.capabilities && n.capabilities.sms,
        voice_url: n.voice_url,
        status_callback: n.status_callback,
      })),
      erreur_numeros: numeros.ok ? null : numeros.data,
    });
  }

  if (req.method === "POST") {
    const { sid, couper } = req.body || {};
    if (!sid || !/^PN[0-9a-f]{32}$/i.test(sid)) return res.status(400).json({ erreur: "sid invalide" });
    const params = couper
      ? { VoiceUrl: "", StatusCallback: "" }
      : {
          VoiceUrl: `${base}/api/voix-ia`,
          VoiceMethod: "POST",
          StatusCallback: `${base}/api/voix-ia?etape=fin`,
          StatusCallbackMethod: "POST",
        };
    const r = await twilio(`/IncomingPhoneNumbers/${sid}.json`, {
      method: "POST",
      body: new URLSearchParams(params).toString(),
    });
    return res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      numero: r.data.phone_number,
      voice_url: r.data.voice_url,
      status_callback: r.data.status_callback,
      erreur: r.ok ? null : r.data,
    });
  }

  return res.status(405).json({ erreur: "méthode non autorisée" });
}
