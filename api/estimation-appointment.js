// api/estimation-appointment.js
// Complète le parcours du formulaire d'estimation détaillée : après avoir vu
// son estimation, le client peut prendre rendez-vous avec un technicien pour
// connaître le détail exact du devis, les contraintes du chantier et les
// remises éventuelles. Le rendez-vous vient enrichir le MÊME dossier lead
// déjà créé par submit-estimation.js (pas de doublon), pour que SalesFlow
// System affiche un dossier complet : nom, adresse, montant estimé, RDV.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN;
const CALENDLY_EVENT_TYPE_URI = process.env.CALENDLY_EVENT_TYPE_URI;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

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
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendSms(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) return false;
  try {
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) console.error("Twilio SMS error:", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms error:", err.message);
    return false;
  }
}

function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("33")) return "+" + digits;
  if (digits.startsWith("0")) return "+33" + digits.slice(1);
  return "+" + digits;
}

// ---------- Calendly ----------
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
    try { data = JSON.parse(text); } catch (e) { console.error("Calendly: réponse non-JSON:", text); }
  }
  if (!res.ok) {
    console.error("Calendly error:", JSON.stringify(data));
    throw new Error(data.message || `Calendly error ${res.status}`);
  }
  return data;
}

const CALENDLY_USER_URI = "https://api.calendly.com/users/4945a47a-343c-41a1-92e1-0d08e6b5ed01";
let eventTypesCache = null;

async function getEventTypes() {
  if (eventTypesCache) return eventTypesCache;
  const data = await calendlyRequest(`/event_types?user=${encodeURIComponent(CALENDLY_USER_URI)}&active=true`);
  eventTypesCache = data.collection || [];
  return eventTypesCache;
}

async function findEventTypeUri(keyword) {
  const types = await getEventTypes();
  const found = types.find((t) => t.name.toLowerCase().includes(keyword.toLowerCase()));
  return found ? found.uri : CALENDLY_EVENT_TYPE_URI;
}

async function getAvailableSlots() {
  const eventTypeUri = await findEventTypeUri("téléphonique");
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  });
  const data = await calendlyRequest(`/event_type_available_times?${params}`);
  return (data.collection || []).slice(0, 8).map((s) => s.start_time);
}

async function bookAppointment(startTimeIso, name, email, phone) {
  const eventTypeUri = await findEventTypeUri("téléphonique");
  const body = {
    event_type: eventTypeUri,
    start_time: startTimeIso,
    invitee: { name, email, timezone: "Europe/Paris" },
    location: { kind: "outbound_call", location: toE164(phone) },
  };
  return calendlyRequest("/invitees", { method: "POST", body: JSON.stringify(body) });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const slots = await getAvailableSlots();
      return res.status(200).json({ success: true, slots });
    }

    if (req.method === "POST") {
      const { lead_id, start_time_iso, nom, prenom, email, telephone } = req.body || {};
      if (!lead_id || !start_time_iso || !email || !telephone) {
        return res.status(400).json({ success: false, error: "Champs requis manquants." });
      }

      const fullName = `${prenom || ""} ${nom || ""}`.trim() || "Client";
      const result = await bookAppointment(start_time_iso, fullName, email, telephone);
      const confirmedTime = result.resource?.event?.start_time || start_time_iso;
      const cancelUrl = result.resource?.cancel_url || null;
      const rescheduleUrl = result.resource?.reschedule_url || null;

      // Enrichit le dossier existant (créé par submit-estimation.js) plutôt
      // que de créer un doublon.
      await supabaseRequest(`leads?id=eq.${lead_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          rdv_date: confirmedTime,
          rdv_cancel_url: cancelUrl,
          rdv_reschedule_url: rescheduleUrl,
          statut: "contacté",
        }),
        prefer: "return=minimal",
      });

      let formattedDate = confirmedTime;
      try {
        formattedDate = new Intl.DateTimeFormat("fr-FR", {
          weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
          timeZone: "Europe/Paris",
        }).format(new Date(confirmedTime));
      } catch (e) {}

      const phoneE164 = toE164(telephone);
      if (phoneE164) {
        await sendSms(phoneE164, `Rendez-vous confirmé avec RMS ECOSKY : ${formattedDate}. Un technicien vous appellera pour détailler votre devis. À bientôt !`);
      }
      await sendSms(TWILIO_TO_NUMBER, `📅 RDV technicien confirmé (estimation détaillée) !\n${fullName} — ${telephone}\n${formattedDate}`);

      return res.status(200).json({ success: true, confirmed_time: confirmedTime, formatted_date: formattedDate });
    }

    return res.status(405).send("Method not allowed");
  } catch (err) {
    console.error("estimation-appointment error:", err.message);
    return res.status(200).json({
      success: false,
      error: "La prise de rendez-vous a échoué techniquement. Un conseiller RMS ECOSKY vous recontactera.",
    });
  }
}
