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
  "https://wklddwumirkdjkbxvzyj.supabase.co/storage/v1/object/public/media/VIDEO-2026-07-13-22-59-06.mp4";

// Départements dans la zone d'intervention EcoSky
const ALLOWED_DEPARTMENTS = ["56", "29", "22", "35"];

// Départements limitrophes : le devis peut être possible selon la distance exacte du projet
const BORDER_DEPARTMENTS = ["44"];

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

// catalogueStatus possibles :
//  - "just_sent"          : PDF + vidéo envoyés avec succès à l'instant
//  - "just_sent_no_video"  : PDF envoyé avec succès, mais la vidéo a échoué
//  - "already_sent"        : PDF envoyé lors d'un message précédent (peu importe la vidéo)
//  - "already_sent_no_video": PDF envoyé précédemment, mais la vidéo n'était jamais passée
//  - "failed"               : le PDF lui-même a échoué (rien n'est parti)
function buildSystemPrompt(catalogueStatus) {
  let catalogueInstruction;
  if (catalogueStatus === "just_sent") {
    catalogueInstruction = `3. Le système vient d'envoyer automatiquement le catalogue PDF (photos et coloris) et une
   courte vidéo de présentation, juste avant ta réponse — tu n'as donc pas besoin de décrire le
   catalogue en détail ni de coller de lien vers lui. Annonce simplement que tu les envoies/viens
   de les envoyer ("Je vous partage justement notre catalogue et une petite vidéo pour vous donner
   des idées !").`;
  } else if (catalogueStatus === "just_sent_no_video") {
    catalogueInstruction = `3. Le système vient d'envoyer automatiquement le catalogue PDF (photos et coloris) — mentionne
   bien que tu viens de le partager. En revanche, l'envoi de la vidéo de présentation a échoué
   techniquement : ne mentionne AUCUNE vidéo dans ta réponse, ni ne dis que tu l'as envoyée ou que
   tu vas l'envoyer.`;
  } else if (catalogueStatus === "already_sent") {
    catalogueInstruction = `3. Le catalogue PDF et la vidéo de présentation ont déjà été envoyés au client plus tôt dans
   cette conversation. Ne les renvoie pas et ne propose pas de les renvoyer, sauf si le client te le
   demande explicitement.`;
  } else if (catalogueStatus === "already_sent_no_video") {
    catalogueInstruction = `3. Le catalogue PDF a déjà été envoyé au client plus tôt dans cette conversation — ne le renvoie
   pas et n'en reparle pas, sauf si le client le redemande. La vidéo de présentation, en revanche,
   n'a jamais pu être envoyée (échec technique) : ne dis jamais que tu l'as envoyée ou que tu vas
   l'envoyer, et ne la mentionne pas.`;
  } else {
    // "failed" : rien n'est parti (ni PDF, ni vidéo)
    catalogueInstruction = `3. IMPORTANT — L'envoi automatique du catalogue PDF et de la vidéo a échoué techniquement.
   Ne dis JAMAIS que tu envoies ou viens d'envoyer un catalogue ou une vidéo. N'en fais pas mention
   du tout dans ta réponse. Concentre-toi uniquement sur la conversation avec le client ; l'envoi
   sera retenté automatiquement en arrière-plan.`;
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
   - Localisation du projet : demande la VILLE et le CODE POSTAL à 5 chiffres (nécessaire pour
     vérifier que le projet est bien dans notre zone d'intervention)
   - Support actuel (béton existant, terre, dallage...)
   - Délai souhaité
   - Coloris envisagé si pertinent (la gamme EcoSky'Gum propose plusieurs teintes)

2bis. IMPORTANT — Ne suppose et n'invente JAMAIS un détail du projet du client (surface, ville,
   support, délai...) qu'il n'a pas explicitement mentionné dans la conversation. Base-toi
   uniquement sur ce que le client a réellement écrit, mot pour mot. Si une information manque,
   est ambiguë, ou si tu as un doute sur ce que le client a dit précédemment, pose la question
   au lieu de l'affirmer ou de la deviner. Ne confonds jamais les informations sur l'entreprise
   (ex : sa localisation à Brech) avec des informations sur le projet du client.

2ter. LOCALISATION DU PROJET — Dès que le client te communique le code postal (5 chiffres) du
   lieu du projet, utilise IMMÉDIATEMENT l'outil "save_project_location" pour l'enregistrer, même
   si tu n'as pas encore toutes les autres informations. Si le client donne seulement une ville
   sans code postal, demande-lui le code postal pour confirmer (plusieurs villes peuvent avoir un
   nom proche dans des régions différentes).

2quinquies. SURFACE MINIMUM — RMS ECOSKY n'intervient pas pour des surfaces inférieures à 10 m².
   Dès que le client communique une surface en dessous de ce seuil, indique-le-lui poliment (par
   exemple : "Pour ce type de petite surface, malheureusement nous n'intervenons pas en dessous de
   10 m² — n'hésitez pas à revenir vers nous si votre projet évolue !") et ne poursuis pas la
   qualification ni le chiffrage pour ce projet. Si la surface est incertaine ou visiblement proche
   du seuil (ex: "environ 10m²"), tu peux demander une confirmation avant de clore.

${catalogueInstruction}

4. Dès que tu as une idée claire du projet, encourage le client à envoyer des photos ou une courte
   vidéo de la zone concernée via ce lien pour un chiffrage précis : ${DEVIS_URL}
   EXCEPTION : si tu viens de donner une estimation de prix chiffrable selon la règle 6 (dalle,
   carrelage retiré par le client, pavé, ou parking carrossable), ne demande PAS de photos —
   propose plutôt un appel téléphonique comme indiqué dans cette règle.

5. Reste bref, chaleureux, professionnel, en français. Pas de longs pavés — c'est une conversation
   WhatsApp, pas un email. 2-4 phrases maximum par message.

6. ESTIMATION DE PRIX — En général, tu ne donnes PAS de prix précis avant d'avoir identifié le
   support existant et l'usage prévu (piéton ou carrossable). Dès que tu as ces informations, donne
   une estimation indicative de façon PROACTIVE (sans attendre que le client la demande), selon
   cette grille :

   USAGE PIÉTON (terrasse, tour de piscine, allée piétonne) — demande TOUJOURS quel est le support
   actuel s'il n'est pas encore précisé :
   - DALLE BÉTON EXISTANTE : demande dans quel état elle est. Dans tous les cas, estimation à
     115€ HT/m² (hors baguette de contour). Si elle est fissurée ou nécessite une réparation,
     précise qu'une PLUS-VALUE s'ajoutera à ce prix, dont le montant sera confirmé par un
     technicien (n'invente jamais ce montant).
   - CARRELAGE EXISTANT : demande qui va retirer les carreaux existants avant l'intervention. Si le
     client s'en charge lui-même, applique le même tarif que "dalle béton existante" ci-dessus
     (115€ HT/m², plus-value éventuelle selon l'état une fois les carreaux enlevés). Si c'est RMS
     ECOSKY qui doit retirer les carreaux, N'INVENTE AUCUN PRIX : indique que ce retrait doit être
     chiffré par un technicien.
   - PAVÉ AUTOBLOQUANT EXISTANT : estimation à partir de 115€ HT/m², en précisant que le tarif
     définitif dépend de l'état des pavés et sera validé par un technicien.
   - TERRAIN NU (rien n'existe) en usage piéton : N'INVENTE AUCUN PRIX, ce cas nécessite toujours
     une visite technicien pour être chiffré.

   USAGE CARROSSABLE (parking, allée pour véhicule) — demande TOUJOURS l'état actuel du terrain :
   - TERRE NUE, tout est à refaire : estimation à 180€ HT/m², en précisant que ce prix comprend le
     terrassement, l'évacuation, la pose d'un concassé, le profilage et le compactage. Une bordure
     est possible en option, à 45€ HT/mètre linéaire (demande la longueur souhaitée si le client
     est intéressé).
   - TERRAIN DÉJÀ PRÉPARÉ / stabilisé : estimation à partir de 150€ HT/m², à valider avec un
     technicien.
   Précise TOUJOURS pour un projet carrossable que ce tarif correspond à un granulat de quartz
   couleur beige/jaune, et qu'une plus-value de 50€ HT/m² s'applique pour toute autre couleur —
   demande la couleur souhaitée si ce n'est pas déjà précisé.

   Dans tous les cas chiffrables ci-dessus, demande TOUJOURS l'âge du bâtiment avant de donner le
   prix TTC (dans le même message que l'estimation, ou juste après si tu ne l'as pas encore), car
   la TVA applicable en dépend : 10% si le bâtiment a plus de 2 ans, 20% s'il a moins de 2 ans.
   Précise TOUJOURS que cette estimation reste indicative et devra être confirmée après un premier
   échange, puis lors d'une visite sur site si le projet avance, avant validation définitive du
   devis. IMPORTANT : dans tous ces cas chiffrables (dalle, carrelage retiré par le client, pavé,
   parking), NE demande PAS l'envoi de photos ou de vidéo — propose plutôt un court appel
   téléphonique de 15 minutes avec l'équipe RMS ECOSKY (via l'outil "get_available_slots" /
   "book_appointment", comme au point 8) pour bien qualifier le projet ensemble et affiner cette
   première estimation. Précise que ce premier appel permet ensuite, si le client souhaite
   avancer, d'organiser une visite sur place pour prendre les mesures exactes, donner le chiffrage
   définitif et montrer les différents coloris disponibles. Ne saute JAMAIS cette étape une fois le
   support et l'usage confirmés : ne clôture pas la conversation sans avoir d'abord donné cette
   estimation (ou expliqué pourquoi ce n'est pas chiffrable en ligne, cas terrain nu piéton ou
   carrelage à retirer par nos soins).

6bis. ESTIMATION DÉTAILLÉE (formulaire) — Juste après avoir donné l'estimation rapide de la règle 6
   (ou si le client demande explicitement un chiffrage plus précis/détaillé), propose-lui TOUJOURS
   en complément une estimation plus approfondie, en lui expliquant que ça ne prend que quelques
   minutes et qu'il recevra le résultat directement par SMS : "Si vous voulez une estimation encore
   plus précise en répondant à quelques questions supplémentaires sur votre projet (état du support,
   usage, délai, coloris...), vous pouvez remplir ce formulaire rapide : https://salesflow-ecosky.vercel.app/estimation.html"
   Laisse le client libre de choisir : rester dans la conversation avec l'estimation rapide déjà
   donnée, ou cliquer sur ce lien pour une estimation plus détaillée. Ne force jamais le formulaire,
   propose-le simplement comme une option.

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
   IMPORTANT — Si le client pose une NOUVELLE question ou change de sujet pendant que tu es en train
   de proposer/finaliser un rendez-vous (par exemple une question sur le prix, la surface, un autre
   aspect du projet), réponds D'ABORD à cette nouvelle question normalement (en appliquant les
   règles concernées, comme la règle 6 sur les prix), PUIS reviens ensuite proposer ou reconfirmer le
   rendez-vous si pertinent. Ne répète JAMAIS ta précédente question de rendez-vous sans avoir
   d'abord traité ce que le client vient de dire.

9. Ne mentionne jamais que tu es une IA. Tu es "l'équipe RMS ECOSKY".`;
}

const TOOLS = [
  {
    name: "save_project_location",
    description:
      "Enregistre le code postal (et optionnellement la ville) du lieu du projet dès que le client les communique, pour vérifier que le projet est dans la zone d'intervention de RMS ECOSKY.",
    input_schema: {
      type: "object",
      properties: {
        postal_code: {
          type: "string",
          description: "Code postal à 5 chiffres du lieu du projet, ex: 56400.",
        },
        city: {
          type: "string",
          description: "Ville du projet, si communiquée par le client.",
        },
      },
      required: ["postal_code"],
    },
  },
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

async function sendSms(messageBody) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    console.error("Twilio: variables d'environnement manquantes, SMS non envoyé.");
    return;
  }
  try {
    const body = new URLSearchParams({
      To: TWILIO_TO_NUMBER,
      From: TWILIO_FROM_NUMBER,
      Body: messageBody,
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
    console.error("sendSms error:", err.message);
  }
}

async function sendSmsNotification(phone, contactName, referral) {
  const adInfo = referral?.source_id ? `\n📢 Pub : ${referral.source_id}` : "";
  await sendSms(
    `🔔 Nouveau prospect WhatsApp !\n${contactName ? contactName + " — " : ""}${phone}${adInfo}`
  );
}

async function sendAppointmentSms(name, phone, startTimeIso) {
  let formattedDate = startTimeIso;
  try {
    formattedDate = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    }).format(new Date(startTimeIso));
  } catch (err) {
    console.error("sendAppointmentSms: erreur de formatage de date:", err.message);
  }
  await sendSms(
    `📅 Nouveau RDV téléphonique confirmé !\n${name} — ${phone}\n${formattedDate}`
  );
}

async function ensureLeadExists(phone, contactName, referral) {
  try {
    const existing = await supabaseRequest(`leads?telephone=eq.${phone}`);
    if (existing && existing.length > 0) return;

    // Si le message vient d'un clic sur une pub Click-to-WhatsApp, Meta fournit
    // un objet "referral" avec l'ID de l'annonce et son texte — on le garde
    // pour savoir précisément quelle pub a généré ce lead.
    const adId = referral?.source_id || null;
    const adHeadline = referral?.headline || null;
    const source = adId ? `Facebook Ads (annonce ${adId})` : "WhatsApp";

    await supabaseRequest("leads", {
      method: "POST",
      body: JSON.stringify({
        nom: contactName || phone,
        telephone: phone,
        source,
        ad_id: adId,
        ad_headline: adHeadline,
        statut: "nouveau",
        notes: "",
      }),
      prefer: "return=minimal",
    });
    // Nouveau prospect détecté pour la première fois : on prévient par SMS
    await sendSmsNotification(phone, contactName, referral);
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
    // Log détaillé pour diagnostiquer précisément pourquoi la vidéo échoue
    // (taille trop grande, format non supporté, lien inaccessible, etc.)
    console.error(`WhatsApp video send error pour ${to}:`, errText);
    return false;
  }
  return true;
}

// Retourne désormais un objet détaillant le succès de CHAQUE média séparément,
// pour que l'appelant sache précisément si la vidéo a échoué même si le PDF est parti.
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

  if (!documentSent) {
    console.error(`Catalogue non envoyé pour ${phone} — sera retenté au prochain message.`);
    // Le PDF étant le média principal, on ne marque rien comme envoyé du tout :
    // tout sera retenté (PDF + vidéo) au prochain message.
    return { documentSent: false, videoSent: false };
  }

  if (!videoSent) {
    console.error(`Vidéo non envoyée pour ${phone} — le catalogue PDF, lui, est bien parti.`);
  }

  // On marque le PDF comme envoyé dès qu'il est parti (c'est le principal),
  // et on trace séparément si la vidéo est passée ou non, pour ne plus jamais
  // laisser l'IA prétendre l'avoir envoyée si ce n'est pas le cas.
  await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
    method: "PATCH",
    body: JSON.stringify({ media_sent: true, video_sent: videoSent }),
    prefer: "return=minimal",
  });
  return { documentSent: true, videoSent };
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
    if (toolName === "save_project_location") {
      await supabaseRequest(`leads?telephone=eq.${phone}`, {
        method: "PATCH",
        body: JSON.stringify({ code_postal: toolInput.postal_code }),
        prefer: "return=minimal",
      });
      const allowed = isDepartmentAllowed(toolInput.postal_code);
      const border = isBorderDepartment(toolInput.postal_code);
      return JSON.stringify({
        success: true,
        in_zone: allowed,
        border_zone: border && !allowed,
      });
    }
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
      const confirmedTime = result.resource?.event?.start_time;
      // Nouveau RDV confirmé : on prévient par SMS
      await sendAppointmentSms(toolInput.name, phone, confirmedTime);
      return JSON.stringify({
        success: true,
        confirmed_time: confirmedTime,
        cancel_url: result.resource?.cancel_url,
        reschedule_url: result.resource?.reschedule_url,
      });
    }
    return JSON.stringify({ error: "Outil inconnu" });
  } catch (err) {
    console.error(`Tool error (${toolName}):`, err.message);
    if (toolName === "book_appointment") {
      return JSON.stringify({
        error: true,
        message:
          "La réservation a échoué — ce créneau vient probablement d'être pris entre-temps, ou une erreur technique est survenue. N'invente SURTOUT PAS un nouveau créneau toi-même : appelle à nouveau l'outil get_available_slots pour récupérer les VRAIS créneaux encore disponibles, puis reproposes-en 2 ou 3 au client avant de retenter une réservation.",
      });
    }
    return JSON.stringify({
      error: true,
      message:
        "La consultation des disponibilités a échoué techniquement. Explique au client qu'il y a un petit souci technique et qu'un conseiller RMS ECOSKY le recontactera pour fixer un horaire, sans inventer ni confirmer aucun créneau.",
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
  for (let i = 0; i < 6; i++) {
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
    // Présent uniquement si le message provient d'un clic sur une pub Click-to-WhatsApp
    const referral = message.referral || null;
    const conversation = await getConversation(phone);
    if (contactName) {
      await supabaseRequest(`wa_conversations?phone=eq.${phone}`, {
        method: "PATCH",
        body: JSON.stringify({ nom: contactName }),
        prefer: "return=minimal",
      });
    }
    await ensureLeadExists(phone, contactName, referral);
    await saveMessage(phone, "user", incomingText);

    const codePostal = await getLeadCodePostal(phone);
    if (!isDepartmentAllowed(codePostal)) {
      console.log(`Lead hors zone (${codePostal}) — message de courtoisie pour ${phone}`);
      const politeMessage =
        "Merci pour votre message ! Malheureusement, RMS ECOSKY n'intervient pas dans votre secteur pour le moment. Nous intervenons en Bretagne, dans le Morbihan (56), le Finistère (29), les Côtes-d'Armor (22) et l'Ille-et-Vilaine (35). Bonne continuation dans votre projet !";
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
    // et n'annonce jamais un envoi (PDF ou vidéo) qui n'a pas eu lieu.
    let catalogueStatus;
    if (!conversation.media_sent) {
      const { documentSent, videoSent } = await sendCatalogueAndVideo(phone);
      if (!documentSent) {
        catalogueStatus = "failed";
      } else if (videoSent) {
        catalogueStatus = "just_sent";
      } else {
        catalogueStatus = "just_sent_no_video";
      }
    } else {
      // Le catalogue avait déjà été envoyé avant : on regarde si la vidéo,
      // elle, avait fini par passer ou non lors de cet envoi précédent.
      catalogueStatus = conversation.video_sent ? "already_sent" : "already_sent_no_video";
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
