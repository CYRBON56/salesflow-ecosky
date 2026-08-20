// api/track-click.js
// Enregistre chaque arrivée sur le site depuis une pub Facebook, Google Ads
// (ou autre source trackée), même si la personne ne finit jamais par discuter
// avec Skyeco. Appelé automatiquement par le widget de chat au chargement de la page.
//
// Deux choses se produisent à chaque clic pub identifié (fbclid/gclid) :
//   1. Enregistrement dans web_clicks (stats brutes, comme avant)
//   2. Création d'une fiche minimale dans "leads" (demande Cyrille, 19/08/2026)
//      pour que ces visiteurs apparaissent directement dans le dashboard
//      SalesFlow, pas seulement dans la modale "Clics pub" séparée.
//
// SMS "arrivée pub" reste DÉSACTIVÉ (demande précédente du 19/08/2026).

import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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
      Prefer: options.prefer || "return=minimal",
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

// Vercel ajoute automatiquement ces en-têtes de géolocalisation approximative
// (déduite de l'IP, pas du GPS) sur chaque requête entrante.
function getGeoFromRequest(req) {
  const h = req.headers || {};
  return {
    country: h["x-vercel-ip-country"] || null,
    region: h["x-vercel-ip-region"] || null,
    city: h["x-vercel-ip-city"] ? decodeURIComponent(h["x-vercel-ip-city"]) : null,
    latitude: h["x-vercel-ip-latitude"] || null,
    longitude: h["x-vercel-ip-longitude"] || null,
  };
}

async function sendClickAlertSms({ source, ad_id, utm_campaign, landing_page, geo }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    console.error("track-click SMS skipped: variables Twilio manquantes");
    await logSms({
      sms_type: "arrivee_pub",
      destinataire: TWILIO_TO_NUMBER,
      source,
      utm_campaign,
      geo_city: geo.city,
      geo_region: geo.region,
      geo_country: geo.country,
      twilio_success: false,
    });
    return;
  }

  const localisation = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");

  const body =
    `Nouveau visiteur via pub ${source}\n` +
    (utm_campaign ? `Campagne: ${utm_campaign}\n` : "") +
    (ad_id ? `Ad ID: ${ad_id}\n` : "") +
    (localisation ? `Provenance: ${localisation}\n` : "") +
    (landing_page ? `Page: ${landing_page}` : "");

  const params = new URLSearchParams({
    To: TWILIO_TO_NUMBER,
    From: TWILIO_FROM_NUMBER,
    Body: body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`Twilio error ${res.status}: ${text}`);
  }

  await logSms({
    sms_type: "arrivee_pub",
    destinataire: TWILIO_TO_NUMBER,
    source,
    utm_campaign,
    geo_city: geo.city,
    geo_region: geo.region,
    geo_country: geo.country,
    message_body: body,
    twilio_success: res.ok,
  });
}

// Crée une fiche lead minimale pour ce clic pub, afin qu'il apparaisse dans
// le dashboard SalesFlow au même titre qu'un lead venu du formulaire. On
// déduplique sur le clic publicitaire exact (gclid ou fbclid, stocké au
// début des notes, préfixé) plutôt que sur la session : deux clics sur la
// même pub avec le même gclid/fbclid ne créent qu'une seule fiche, même si
// le visiteur recharge la page ou revient dans un nouvel onglet.
async function createLeadFromClick({ source, utm_campaign, click_id, geo }) {
  if (!click_id) return; // pas de gclid/fbclid = pas de dédoublonnage fiable, on n'insère pas

  const marker = `[clic_id:${click_id}]`;

  try {
    const existing = await supabaseRequest(
      `leads?notes=ilike.*${encodeURIComponent(marker)}*&select=id&limit=1`
    );
    if (Array.isArray(existing) && existing.length > 0) return; // déjà créé pour ce clic
  } catch (err) {
    console.error("createLeadFromClick dedupe check error:", err.message);
    // en cas de doute on continue quand même, mieux vaut un doublon occasionnel que perdre le lead
  }

  const localisation = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");

  try {
    await supabaseRequest("leads", {
      method: "POST",
      body: JSON.stringify({
        nom: `Visiteur pub ${source}`,
        prenom: null,
        telephone: "",
        type_projet: null,
        source: `Clic pub ${source}${utm_campaign ? " — " + utm_campaign : ""}`,
        statut: "nouveau",
        formulaire_complete: false,
        notes: `${marker} Clic publicitaire détecté${localisation ? `, provenance approximative : ${localisation}` : ""}. Ce visiteur n'a pas encore rempli de formulaire.`,
      }),
    });
  } catch (err) {
    console.error("createLeadFromClick insert error:", err.message);
    // on ne bloque jamais le visiteur pour un souci de création de fiche
  }
}

export default async function handler(req, res) {
  // On répond toujours OK côté CORS pour que le widget (appelé depuis
  // ecoskybyrms.fr, un domaine différent de Vercel) puisse l'appeler.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const {
      session_id,
      fbclid,
      gclid,
      ad_id,
      utm_source,
      utm_campaign,
      utm_medium,
      landing_page,
      referrer,
    } = req.body || {};

    const geo = getGeoFromRequest(req);

    await supabaseRequest("web_clicks", {
      method: "POST",
      body: JSON.stringify({
        session_id: session_id || null,
        fbclid: fbclid || null,
        gclid: gclid || null,
        ad_id: ad_id || null,
        utm_source: utm_source || null,
        utm_campaign: utm_campaign || null,
        utm_medium: utm_medium || null,
        landing_page: landing_page || null,
        referrer: referrer || null,
        geo_country: geo.country,
        geo_region: geo.region,
        geo_city: geo.city,
        geo_latitude: geo.latitude,
        geo_longitude: geo.longitude,
      }),
    });

    // On filtre les provenances hors France pour la création de fiche
    // lead : ce sont presque toujours des clics automatisés (bots de
    // vérification qualité/anti-fraude de Google, souvent localisés aux
    // US) plutôt que de vrais visiteurs — le passage reste enregistré en
    // base pour les stats, mais ne crée plus de fiche lead inutile. On
    // laisse passer les provenances inconnues, pour ne jamais rater un
    // vrai visiteur si Vercel n'a pas pu déterminer le pays.
    const isMetaAdClick = Boolean(fbclid || ad_id);
    const isGoogleAdClick = Boolean(gclid);
    const isFrenchOrUnknown = !geo.country || geo.country === "FR";

    if (isFrenchOrUnknown) {
      // Toute arrivée sur le formulaire crée une fiche — pas seulement les
      // clics pub identifiés. La source distingue Google Ads / Meta / et
      // "Direct ou organique" (lien partagé, recherche directe, réseaux
      // sociaux non payants...) pour qu'on garde une vue claire de l'origine.
      const source = isGoogleAdClick && !isMetaAdClick
        ? "Google Ads"
        : isMetaAdClick
        ? "Meta"
        : "Direct ou organique";
      const clickId = fbclid || ad_id || gclid || session_id;

      // Fiche lead dans le dashboard SalesFlow
      try {
        await createLeadFromClick({ source, utm_campaign, click_id: clickId, geo });
      } catch (leadErr) {
        console.error("track-click lead creation error:", leadErr.message);
      }

      // SMS "arrivée pub" DÉSACTIVÉ — décommenter pour réactiver.
      /*
      try {
        await sendClickAlertSms({
          source,
          ad_id: ad_id || gclid,
          utm_campaign,
          landing_page,
          geo,
        });
      } catch (smsErr) {
        console.error("track-click SMS error:", smsErr.message);
        // On ne bloque jamais le visiteur pour un souci d'envoi SMS
      }
      */
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("track-click error:", err.message);
    // On ne bloque jamais le visiteur pour un souci de tracking
    return res.status(200).json({ success: false });
  }
}
