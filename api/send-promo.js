// Endpoint à déclencher MANUELLEMENT (pas de cron) chaque fois que Cyrille veut annoncer
// une promo ou un nouveau produit à toute sa base de contacts WhatsApp.
//
// Utilisation : ouvrir cette URL dans le navigateur avec les bons paramètres, par exemple :
// https://salesflow-ecosky.vercel.app/api/send-promo?secret=XXXX&message=promo_ete
//
// Le paramètre "message" correspond au nom du template WhatsApp approuvé par Meta
// (ex: "promo_ecosky"). Chaque campagne différente = un nouveau template à faire approuver.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const PROMO_SECRET = process.env.PROMO_SECRET; // à définir sur Vercel, mot de passe simple

const TEMPLATE_LANGUAGE = "fr";

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

async function sendTemplateMessage(to, templateName, firstName) {
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
          name: templateName,
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
    throw new Error(`WhatsApp send error: ${JSON.stringify(data)}`);
  }
  return data;
}

export default async function handler(req, res) {
  const { secret, message } = req.query;

  if (!PROMO_SECRET || secret !== PROMO_SECRET) {
    return res.status(401).json({ error: "Accès refusé : secret manquant ou incorrect." });
  }

  if (!message) {
    return res.status(400).json({
      error: "Paramètre 'message' manquant. Exemple : ?message=promo_ecosky",
    });
  }

  try {
    const conversations = await supabaseRequest(
      "wa_conversations?select=phone,nom"
    );

    const results = [];

    for (const convo of conversations || []) {
      const firstName = (convo.nom || "").split(" ")[0] || "là";
      try {
        await sendTemplateMessage(convo.phone, message, firstName);
        results.push({ phone: convo.phone, success: true });
      } catch (err) {
        console.error(`Promo send error for ${convo.phone}:`, err.message);
        results.push({ phone: convo.phone, success: false, error: err.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return res.status(200).json({
      template: message,
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (err) {
    console.error("send-promo error:", err);
    return res.status(500).json({ error: err.message });
  }
}
