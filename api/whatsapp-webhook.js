// Webhook WhatsApp Business Cloud API — le "cerveau" du système.
// Reçoit les messages entrants, fait répondre l'IA, envoie la réponse sur WhatsApp,
// et garde tout l'historique dans Supabase.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CATALOGUE_URL = "https://www.ecoskybyrms.fr/nos-services-et-prestations/catalogue";
const DEVIS_URL = "https://www.ecoskybyrms.fr/devis";

const SYSTEM_PROMPT = `Tu es l'assistant commercial WhatsApp de RMS ECOSKY (EcoSky by RMS), une entreprise
basée à Brech (56400, Bretagne, France), spécialisée dans les sols résine EPDM drainants
(gamme EcoSky'Gum) : terrasses, tours de piscine, allées, plages de piscine.

Ton rôle dans cette conversation WhatsApp :
1. Accueille chaleureusement le client et comprends son projet de sol en résine EPDM
   (terrasse, tour de piscine, allée, autre extérieur)
2. Pose des questions utiles et naturelles, une ou deux à la fois maximum, jamais un interrogatoire :
   - Quel type de surface exactement (terrasse, tour de piscine, allée...)
   - Surface approximative (m²)
   - Localisation du projet (ville)
   - Support actuel (béton existant, terre, dallage...)
   - Délai souhaité
   - Coloris envisagé si pertinent (la gamme EcoSky'Gum propose plusieurs teintes)
3. Propose le catalogue quand c'est pertinent : ${CATALOGUE_URL}
4. Dès que tu as une idée claire du projet, encourage le client à envoyer des photos ou une courte
   vidéo de la zone concernée via ce lien pour un chiffrage précis : ${DEVIS_URL}
5. Reste bref, chaleureux, professionnel, en français. Pas de longs pavés — c'est une conversation
   WhatsApp, pas un email. 2-4 phrases maximum par message.
6. Tu ne donnes JAMAIS de prix précis toi-même — le chiffrage se fait après réception des photos.
   Si on te demande un prix, explique que ça dépend du terrain et invite à envoyer des photos via le lien devis.
7. Si le client demande autre chose que de la résine EPDM (assainissement, portail, clôture...),
   indique poliment que tu es dédié aux projets de sol résine EPDM et qu'un conseiller RMS ECOSKY
   le recontactera pour ses autres besoins.
8. Si le client semble prêt (a donné les infos essentielles), remercie-le et dis qu'un conseiller
   RMS ECOSKY va revenir vers lui rapidement pour finaliser.
9. Ne mentionne jamais que tu es une IA. Tu es "l'équipe RMS ECOSKY".`;

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

async function getConversation(phone) {
  const rows = await supabaseRequest(`wa_conversations?phone=eq.${phone}`);
  if (rows && rows.length > 0) return rows[0];
  const created = await supabaseRequest("wa_conversations", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return created[0];
}

async function getHistory(phone) {
  const rows = await supabaseRequest(
    `wa_messages?phone=eq.${phone}&order=created_at.asc&limit=30`
  );
  return rows || [];
}

async function saveMessage(phone, role, content) {
  await supabaseRequest("wa_messages", {
    method: "POST",
    body: JSON.stringify({ phone, role, content }),
    prefer: "return=minimal",
  });
  await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
    method: "PATCH",
    body: JSON.stringify({ last_message_at: new Date().toISOString() }),
    prefer: "return=minimal",
  });
}

async function askClaude(history) {
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${JSON.stringify(data)}`);
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "Merci pour votre message, on revient vers vous rapidement !";
}

async function sendWhatsAppMessage(to, text) {
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
        type: "text",
        text: { body: text },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.error("WhatsApp send error:", errText);
  }
}

export default async function handler(req, res) {
  // Vérification du webhook par Meta (première connexion)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // Peut être un accusé de statut (delivered/read), on ignore silencieusement
      return res.status(200).send("EVENT_RECEIVED");
    }

    const phone = message.from;
    const incomingText =
      message.text?.body || message.button?.text || "[message non textuel reçu]";
    const contactName = value?.contacts?.[0]?.profile?.name || "";

    await getConversation(phone);
    if (contactName) {
      await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
        method: "PATCH",
        body: JSON.stringify({ nom: contactName }),
        prefer: "return=minimal",
      });
    }

    await saveMessage(phone, "user", incomingText);
    const history = await getHistory(phone);
    const reply = await askClaude(history);
    await saveMessage(phone, "assistant", reply);
    await sendWhatsAppMessage(phone, reply);

    return res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).send("EVENT_RECEIVED"); // toujours 200 pour éviter que Meta ne réessaie en boucle
  }
}
