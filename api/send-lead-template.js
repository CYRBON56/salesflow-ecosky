// Endpoint appelé par Make.com juste après la création d'un lead dans Supabase.
// Envoie le template WhatsApp "nouveau_lead_epdm" (approuvé par Meta) pour lancer
// la conversation avec le prospect, puisque WhatsApp interdit d'envoyer un message
// libre à quelqu'un qui ne nous a jamais écrit.

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TEMPLATE_NAME = "nouveau_lead_epdm";
const TEMPLATE_LANGUAGE = "fr"; // ajuster si Meta l'a validé sous un autre code (ex: "fr_FR")

const OWNER_NOTIFICATION_TEMPLATE = "notif_nouveau_lead";
const OWNER_PHONE = "33645688394"; // numéro WhatsApp de Cyrille, format international sans +

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

// Normalise un numéro de téléphone français (ex: 0659805046) au format international
// attendu par l'API WhatsApp (ex: 33659805046), sans le "+".
function normalizePhone(phone) {
  let digits = String(phone).replace(/[^\d]/g, "");
  if (digits.startsWith("0")) {
    digits = "33" + digits.slice(1);
  }
  if (digits.startsWith("33") === false && digits.length <= 10) {
    digits = "33" + digits;
  }
  return digits;
}

async function sendTemplateMessage(to, firstName) {
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
    throw new Error(`WhatsApp template send error: ${JSON.stringify(data)}`);
  }
  return data;
}

async function notifyOwner(firstName) {
  try {
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
          to: OWNER_PHONE,
          type: "template",
          template: {
            name: OWNER_NOTIFICATION_TEMPLATE,
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
      console.error("notifyOwner error:", JSON.stringify(data));
    }
  } catch (err) {
    // Ne bloque jamais l'envoi du message client si la notif interne échoue
    console.error("notifyOwner error:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone, nom } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Le champ 'phone' est requis." });
    }

    const normalizedPhone = normalizePhone(phone);
    const firstName = (nom || "").split(" ")[0] || "là";

    const result = await sendTemplateMessage(normalizedPhone, firstName);
    await notifyOwner(firstName);

    // Trace l'envoi dans wa_conversations pour que le webhook ne renvoie pas
    // le catalogue en double si le client répond ensuite normalement.
    const existing = await supabaseRequest(
      `wa_conversations?phone=eq.${normalizedPhone}`
    );
    if (!existing || existing.length === 0) {
      await supabaseRequest("wa_conversations", {
        method: "POST",
        body: JSON.stringify({ phone: normalizedPhone, nom }),
        prefer: "return=minimal",
      });
    }

    return res.status(200).json({ success: true, whatsapp_response: result });
  } catch (err) {
    console.error("send-lead-template error:", err);
    return res.status(500).json({ error: err.message });
  }
}
