// Endpoint exécuté automatiquement une fois par jour (via Vercel Cron, voir vercel.json).
// Parcourt les conversations WhatsApp et envoie une relance "projet toujours d'actualité ?"
// à 24h, 3 jours puis 7 jours si le lead n'a plus donné signe de vie depuis le début
// de la conversation. Une seule relance par palier, jamais plus de 3 au total.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const CRON_SECRET = process.env.CRON_SECRET; // optionnel, pour sécuriser l'accès

const TEMPLATE_NAME = "relance_projet";
const TEMPLATE_LANGUAGE = "fr";

const STAGES = [
  { key: "24h", hoursSince: 24, next: "3j" },
  { key: "3j", hoursSince: 72, next: "7j" },
  { key: "7j", hoursSince: 168, next: null },
];

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendRelanceTemplate(to, firstName) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`WhatsApp relance send error: ${JSON.stringify(data)}`);
  }
  return data;
}

function hoursSince(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60);
}

export default async function handler(req, res) {
  // Sécurité simple : Vercel Cron envoie ce header automatiquement.
  if (CRON_SECRET) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const conversations = await supabaseRequest(
      "wa_conversations?select=phone,nom,created_at,last_message_at,relance_stage"
    );

    const results = [];

    for (const convo of conversations || []) {
      // On ne relance pas une conversation active récemment (le client vient d'écrire)
      if (convo.last_message_at && hoursSince(convo.last_message_at) < 24) {
        continue;
      }

      const currentStage = convo.relance_stage; // null, "24h", "3j", ou "7j"
      const elapsed = hoursSince(convo.created_at);

      // Trouve le prochain palier à envoyer, dans l'ordre
      const nextStage = STAGES.find((s) => {
        const alreadyPassedThisStage =
          currentStage === s.key ||
          STAGES.findIndex((x) => x.key === currentStage) >=
            STAGES.findIndex((x) => x.key === s.key);
        return !alreadyPassedThisStage && elapsed >= s.hoursSince;
      });

      if (!nextStage) continue;

      const firstName = (convo.nom || "").split(" ")[0] || "là";

      try {
        await sendRelanceTemplate(convo.phone, firstName);
        await supabaseRequest(`wa_conversations?phone=eq.${convo.phone}`, {
          method: "PATCH",
          body: JSON.stringify({ relance_stage: nextStage.key }),
          prefer: "return=minimal",
        });
        results.push({ phone: convo.phone, stage: nextStage.key, success: true });
      } catch (err) {
        console.error(`Relance error for ${convo.phone}:`, err.message);
        results.push({ phone: convo.phone, stage: nextStage.key, success: false, error: err.message });
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error("send-relances error:", err);
    return res.status(500).json({ error: err.message });
  }
}
