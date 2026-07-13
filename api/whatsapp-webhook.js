// Webhook WhatsApp Business Cloud API — le "cerveau" du système.
// Reçoit les messages entrants, fait répondre l'IA, envoie la réponse sur WhatsApp,
// garde tout l'historique dans Supabase, peut réserver un rendez-vous Calendly
// directement dans la conversation (sans lien externe), et envoie un SMS
// à chaque nouveau prospect via Twilio.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN;
const CALENDLY_EVENT_TYPE_URI = process.env.CALENDLY_EVENT_TYPE_URI;

// Twilio — notification SMS au propriétaire à chaque nouveau prospect
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

const CATALOGUE_URL = "https://www.ecoskybyrms.fr/nos-services-et-prestations/catalogue";
const DEVIS_URL = "https://www.ecoskybyrms.fr/devis";
const CATALOGUE_PDF_URL =
  "https://wklddwumirkdjkbxvzyj.supabase.co/storage/v1/object/public/media/catalogue-ecosky-gum.pdf";
const VIDEO_URL =
  "https://wklddwumirkdjkbxvzyj.supabase.co/storage/v1/object/public/media/v24044gl0000d49h467og65puhaukhig.mp4";

// Départements dans la zone d'intervention EcoSky
const ALLOWED_DEPARTMENTS = ["56"];

// Départements limitrophes : le devis peut être possible selon la distance exacte du projet
const BORDER_DEPARTMENTS = ["44", "22", "35", "29"];

function isDepartmentAllowed(codePostal) {
  if (!codePostal) return true; // pas encore de code postal connu → on laisse passer
  const prefix = String(codePostal).trim().slice(0, 2);
  return ALLOWED_DEPARTMENTS.includes(prefix);
}

function isBorderDepartment(codePostal) {
  if (!codePostal) return false;
  const prefix = String(codePostal).trim().slice(0, 2);
  return BORDER_DEPARTMENTS.includes(prefix);
}

function buildSystemPrompt(catalogueStatus) {
  let catalogueInstruction;
  if (catalogueStatus === "just_sent") {
    catalogueInstruction = `3. Le système vient d'envoyer automatiquement le catalogue PDF (photos et coloris) et une
   courte vidéo de présentation, juste avant ta réponse — tu n'as donc pas besoin de décrire le
   catalogue en détail ni de coller de lien vers lui. Annonce simplement que tu les envoies/viens
   de les envoyer ("Je vous partage justement notre catalogue et une petite vidéo pour vous donner
   des idées !").`;
  } else if (catalogueStatus === "failed") {
    catalogueInstruction = `3. IMPORTANT — L'envoi automatique du catalogue PDF et de la vidéo a échoué techniquement.
   Ne dis JAMAIS que tu envoies ou viens d'envoyer un catalogue ou une vidéo. N'en fais pas mention
   du tout dans ta réponse. Concentre-toi uniquement sur la conversation avec le client ; l'envoi
   sera retenté automatiquement en arrière-plan.`;
  } else {
    // "already_sent" : le catalogue a déjà été envoyé lors d'un message précédent
    catalogueInstruction = `3. Le catalogue PDF et la vidéo de présentation ont déjà été envoyés au client plus tôt dans
   cette conversation. Ne les renvoie pas et ne propose pas de les renvoyer, sauf si le client te le
   demande explicitement.`;
  }

  return `Tu es l'assistant commercial WhatsApp de RMS ECOSKY (EcoSky by RMS), une entreprise
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

2bis. IMPORTANT — Ne suppose et n'invente JAMAIS un détail du projet du client (surface, ville,
   support, délai...) qu'il n'a pas explicitement mentionné dans la conversation. Base-toi
   uniquement sur ce que le client a réellement écrit, mot pour mot. Si une information manque,
   est ambiguë, ou si tu as un doute sur ce que le client a dit précédemment, pose la question
   au lieu de l'affirmer ou de la deviner. Ne confonds jamais les informations sur l'entreprise
   (ex : sa localisation à Brech) avec des informations sur le projet du client.

${catalogueInstruction}

4. Dès que tu as une idée claire du projet, encourage le client à envoyer des photos ou une courte
   vidéo de la zone concernée via ce lien pour un chiffrage précis : ${DEVIS_URL}

5. Reste bref, chaleureux, professionnel, en français. Pas de longs pavés — c'est une conversation
   WhatsApp, pas un email. 2-4 phrases maximum par message.

6. Tu ne donnes JAMAIS de prix précis toi-même — le chiffrage se fait après réception des photos.
   Si on te demande un prix, explique que ça dépend du terrain et invite à envoyer des photos via le lien devis.

7. Si le client demande autre chose que de la résine EPDM (assainissement, portail, clôture...),
   indique poliment que tu es dédié aux projets de sol résine EPDM et qu'un conseiller RMS ECOSKY
   le recontactera pour ses autres besoins.

8. PRISE DE RENDEZ-VOUS — Si le client demande explicitement un rendez-vous, ou si le projet est
   suffisamment qualifié (infos essentielles données) et que le client semble prêt, propose-lui un
   court appel téléphonique de 15 minutes avec l'équipe RMS ECOSKY pour affiner le projet ensemble
   (ce premier échange permet ensuite, si besoin, d'organiser une visite sur place). Utilise
   l'outil "get_available_slots" pour consulter les VRAIS créneaux disponibles. Propose 2 ou 3
   créneaux max, dans un langage naturel (ex : "Jeudi 15 à 14h ou vendredi 16 à 10h, ça vous
   irait ?"). Une fois que le client choisit un créneau, demande-lui son prénom, nom et email s'il
   ne les a pas déjà donnés, puis utilise l'outil "book_appointment" pour réserver directement. Ne
   propose ou n'invente JAMAIS un créneau qui ne vient pas de get_available_slots. Confirme ensuite
   le rendez-vous avec la date/heure exacte une fois la réservation réussie.

9. Ne mentionne jamais que tu es une IA. Tu es "l'équipe RMS ECOSKY".`;
}

const TOOLS = [
  {
    name: "get_available_slots",
    description:
      "Récupère les vrais créneaux disponibles dans l'agenda pour un appel téléphonique (15 minutes), sur les 7 prochains jours.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "book_appointment",
    description:
      "Réserve définitivement un appel téléphonique à un créneau précis, une fois que le client a choisi son horaire et donné son nom et son email.",
    input_schema: {
      type: "object",
      properties: {
        start_time_iso: {
          type: "string",
          description:
            "Date et heure de début du rendez-vous au format ISO 8601 UTC, ex: 2026-07-17T12:00:00Z. Doit correspondre exactement à un créneau retourné par get_available_slots.",
        },
        name: {
          type: "string",
          description: "Prénom et nom du client.",
        },
        email: {
          type: "string",
          description: "Adresse email du client, pour la confirmation du rendez-vous.",
        },
        address: {
          type: "string",
          description:
            "Adresse ou ville du chantier/projet, si le client l'a déjà communiquée dans la conversation. Sinon, laisser vide.",
        },
      },
      required: ["start_time_iso", "name", "email"],
    },
  },
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

async function getConversation(phone) {
  const rows = await supabaseRequest(`wa_conversations?phone=eq.${phone}`);
  if (rows && rows.length > 0) return rows[0];
  const created = await supabaseRequest("wa_conversations", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return created[0];
}

// ---- Twilio (notification SMS) ----

async function sendSmsNotification(phone, contactName) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    console.error("Twilio: variables d'environnement manquantes, SMS non envoyé.");
    return;
  }
  try {
    const body = new URLSearchParams({
      To: TWILIO_TO_NUMBER,
      From: TWILIO_FROM_NUMBER,
      Body: `🔔 Nouveau prospect WhatsApp !\n${contactName ? contactName + " — " : ""}${phone}`,
    });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error("Twilio SMS error:", errText);
    }
  } catch (err) {
    // Ne bloque jamais la réponse au client si le SMS échoue
    console.error("sendSmsNotification error:", err.message);
  }
}

async function ensureLeadExists(phone, contactName) {
  try {
    const existing = await supabaseRequest(`leads?telephone=eq.${phone}`);
    if (existing && existing.length > 0) return;
    await supabaseRequest("leads", {
      method: "POST",
      body: JSON.stringify({
        nom: contactName || phone,
        telephone: phone,
        source: "WhatsApp",
        statut: "nouveau",
        notes: "",
      }),
      prefer: "return=minimal",
    });
    // Nouveau prospect détecté pour la première fois : on prévient par SMS
    await sendSmsNotification(phone, contactName);
  } catch (err) {
    // Ne bloque jamais la réponse au client si la création du lead échoue
    console.error("ensureLeadExists error:", err.message);
  }
}

async function getLeadCodePostal(phone) {
  try {
    const rows = await supabaseRequest(
      `leads?telephone=eq.${phone}&select=code_postal`
    );
    return rows && rows.length > 0 ? rows[0].code_postal : null;
  } catch (err) {
    console.error("getLeadCodePostal error:", err.message);
    return null; // en cas d'erreur, on ne bloque pas
  }
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

// ---- Calendly ----

async function calendlyRequest(path, options = {}) {
  const res = await fetch(`https://api.calendly.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CALENDLY_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Calendly: réponse non-JSON:", text);
    }
  }
  if (!res.ok) {
    console.error("Calendly error:", JSON.stringify(data));
    throw new Error(data.message || `Calendly error ${res.status}`);
  }
  return data;
}

const CALENDLY_USER_URI =
  "https://api.calendly.com/users/4945a47a-343c-41a1-92e1-0d08e6b5ed01";

// Cache en mémoire pour éviter de rappeler l'API Calendly à chaque message
let eventTypesCache = null;

async function getEventTypes() {
  if (eventTypesCache) return eventTypesCache;
  const data = await calendlyRequest(
    `/event_types?user=${encodeURIComponent(CALENDLY_USER_URI)}&active=true`
  );
  eventTypesCache = data.collection || [];
  return eventTypesCache;
}

// Retrouve l'URI d'un type d'événement à partir d'un mot-clé dans son nom
async function findEventTypeUri(keyword) {
  const types = await getEventTypes();
  const found = types.find((t) =>
    t.name.toLowerCase().includes(keyword.toLowerCase())
  );
  return found ? found.uri : CALENDLY_EVENT_TYPE_URI; // repli sur l'ancien si non trouvé
}

async function getAvailableSlots() {
  const eventTypeUri = await findEventTypeUri("téléphonique");

  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000); // à partir d'1h à partir de maintenant
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 jours

  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  });

  const data = await calendlyRequest(`/event_type_available_times?${params}`);
  const slots = (data.collection || []).slice(0, 8).map((s) => s.start_time);
  return slots;
}

// Formate un numéro WhatsApp brut (ex: "33645688394") en E.164 (+33645688394)
function toE164(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

async function bookAppointment(startTimeIso, name, email, phone) {
  const eventTypeUri = await findEventTypeUri("téléphonique");

  const body = {
    event_type: eventTypeUri,
    start_time: startTimeIso,
    invitee: {
      name,
      email,
      timezone: "Europe/Paris",
    },
    // Vrai rendez-vous téléphonique : c'est RMS ECOSKY qui rappelle le client
    // sur le numéro utilisé pour la conversation WhatsApp.
    location: {
      kind: "outbound_call",
      location: toE164(phone),
    },
  };
  const data = await calendlyRequest("/invitees", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data;
}

// ---- WhatsApp ----

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

async function sendWhatsAppDocument(to, link, filename, caption) {
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
        type: "document",
        document: { link, filename, caption },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.error("WhatsApp document send error:", errText);
    return false;
  }
  return true;
}

async function sendWhatsAppVideo(to, link, caption) {
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
        type: "video",
        video: { link, caption },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.error("WhatsApp video send error:", errText);
    return false;
  }
  return true;
}

async function sendCatalogueAndVideo(phone) {
  const documentSent = await sendWhatsAppDocument(
    phone,
    CATALOGUE_PDF_URL,
    "Catalogue-EcoSky-Gum.pdf",
    "📘 Notre catalogue de réalisations EcoSky'Gum"
  );
  const videoSent = await sendWhatsAppVideo(
    phone,
    VIDEO_URL,
    "🎥 Découvrez nos réalisations en vidéo !"
  );

  // On ne marque "envoyé" que si au moins le PDF est bien parti (le principal des deux).
  // Sinon on retentera automatiquement au prochain message du client.
  if (!documentSent) {
    console.error(`Catalogue non envoyé pour ${phone} — sera retenté au prochain message.`);
    return false;
  }

  await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
    method: "PATCH",
    body: JSON.stringify({ media_sent: true }),
    prefer: "return=minimal",
  });
  return true;
}

// ---- Claude avec function calling (outils) ----

async function callAnthropic(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${JSON.stringify(data)}`);
  return data;
}

async function executeTool(toolName, toolInput, phone) {
  try {
    if (toolName === "get_available_slots") {
      const slots = await getAvailableSlots();
      if (slots.length === 0) {
        return "Aucun créneau disponible dans les 7 prochains jours.";
      }
      return JSON.stringify({ available_slots_utc: slots });
    }
    if (toolName === "book_appointment") {
      const result = await bookAppointment(
        toolInput.start_time_iso,
        toolInput.name,
        toolInput.email,
        phone
      );
      return JSON.stringify({
        success: true,
        confirmed_time: result.resource?.event?.start_time,
        cancel_url: result.resource?.cancel_url,
        reschedule_url: result.resource?.reschedule_url,
      });
    }
    return JSON.stringify({ error: "Outil inconnu" });
  } catch (err) {
    console.error(`Tool error (${toolName}):`, err.message);
    return JSON.stringify({
      error: true,
      message:
        "La réservation ou la consultation des disponibilités a échoué. Propose au client de réessayer dans un instant, ou de préciser un autre horaire.",
    });
  }
}

async function askClaude(history, phone, catalogueStatus) {
  const systemPrompt = buildSystemPrompt(catalogueStatus);
  let messages = history.map((m) => ({ role: m.role, content: m.content }));

  // Sécurité : l'API Anthropic exige que la conversation se termine par un message "user".
  // On retire tout message assistant résiduel en fin d'historique, au cas où.
  while (messages.length > 0 && messages[messages.length - 1].role !== "user") {
    messages.pop();
  }
  if (messages.length === 0) {
    return "Merci pour votre message, on revient vers vous rapidement !";
  }

  // Boucle d'utilisation d'outils : max 4 aller-retours pour éviter une boucle infinie
  for (let i = 0; i < 4; i++) {
    const data = await callAnthropic(messages, systemPrompt);

    if (data.stop_reason !== "tool_use") {
      const textBlock = data.content.find((b) => b.type === "text");
      return textBlock
        ? textBlock.text
        : "Merci pour votre message, on revient vers vous rapidement !";
    }

    // L'IA veut utiliser un ou plusieurs outils
    messages.push({ role: "assistant", content: data.content });

    const toolResults = [];
    for (const block of data.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input, phone);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Merci pour votre message ! Un conseiller RMS ECOSKY revient vers vous rapidement.";
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
    const conversation = await getConversation(phone);
    if (contactName) {
      await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
        method: "PATCH",
        body: JSON.stringify({ nom: contactName }),
        prefer: "return=minimal",
      });
    }
    await ensureLeadExists(phone, contactName);
    await saveMessage(phone, "user", incomingText);

    const codePostal = await getLeadCodePostal(phone);
    if (!isDepartmentAllowed(codePostal)) {
      console.log(`Lead hors zone (${codePostal}) — message de courtoisie pour ${phone}`);
      const politeMessage =
        "Merci pour votre message ! Malheureusement, RMS ECOSKY n'intervient pas dans votre secteur pour le moment. Nous sommes situés en Bretagne (Morbihan) et intervenons dans ce département. Bonne continuation dans votre projet !";
      await saveMessage(phone, "assistant", politeMessage);
      await sendWhatsAppMessage(phone, politeMessage);
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (isBorderDepartment(codePostal) && !conversation.border_notice_sent) {
      const borderMessage =
        "Merci pour votre message ! Sachez que nous sommes basés dans le Morbihan (56) : selon la distance exacte de votre projet, une intervention peut être possible, à évaluer au cas par cas. N'hésitez pas à nous en dire plus, nous reviendrons vers vous pour confirmer si c'est réalisable 😊";
      await saveMessage(phone, "assistant", borderMessage);
      await sendWhatsAppMessage(phone, borderMessage);
      await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
        method: "PATCH",
        body: JSON.stringify({ border_notice_sent: true }),
        prefer: "return=minimal",
      });
    }

    // On envoie le catalogue AVANT de générer la réponse texte, pour que l'IA
    // sache avec certitude si l'envoi a réussi, échoué, ou avait déjà eu lieu —
    // et n'annonce jamais un envoi qui n'a pas eu lieu.
    let catalogueStatus = "already_sent";
    if (!conversation.media_sent) {
      const sent = await sendCatalogueAndVideo(phone);
      catalogueStatus = sent ? "just_sent" : "failed";
    }

    const history = await getHistory(phone);
    const reply = await askClaude(history, phone, catalogueStatus);
    await saveMessage(phone, "assistant", reply);
    await sendWhatsAppMessage(phone, reply);
    return res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).send("EVENT_RECEIVED"); // toujours 200 pour éviter que Meta ne réessaie en boucle
  }
}
