// api/sync-meta-leads.js
// Récupère les prospects des formulaires Meta (pubs objectif « Prospects »)
// et les range dans la table leads de SalesFlow, avec canal = "Meta".
// Remplace le scénario Make « Watch Leads » qui ne recevait jamais rien.
//
// Appelé toutes les 5 minutes par Supabase (pg_cron + pg_net), avec la clé
// secrète SYNC_SECRET dans l'URL : /api/sync-meta-leads?key=XXXX
// Peut aussi être appelé à la main dans le navigateur avec la même URL
// pour forcer une synchro (ajouter &jours=30 pour rattraper l'historique).
//
// Variables Vercel nécessaires :
//   META_PAGE_TOKEN  : jeton d'accès permanent (utilisateur système du BM « RMS »)
//   META_PAGE_ID     : 243043852219845 (Page « Ecosky ») — valeur par défaut
//   SYNC_SECRET      : mot de passe libre, le même que dans le cron Supabase
//   (+ SUPABASE_URL, SUPABASE_SERVICE_KEY, TWILIO_* déjà présents)

import { logSms } from "./_sms-log.js";
import { envoyerLien, rafraichirStatutsLiens } from "./_lien-estimation.js";
// Envoi automatique du lien d'estimation aux nouveaux prospects Meta
// (activé par la variable Vercel META_AUTO_LIEN=1)
const AUTO_LIEN = process.env.META_AUTO_LIEN === "1";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const META_PAGE_TOKEN = process.env.META_PAGE_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || "243043852219845";
const SYNC_SECRET = process.env.SYNC_SECRET;
const GRAPH = "https://graph.facebook.com/v21.0";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

let TOKEN = META_PAGE_TOKEN;
async function graph(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(TOKEN)}`);
  const data = await res.json();
  if (data.error) throw new Error(`Meta: ${data.error.message}`);
  return data;
}

async function sendSms(body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) return false;
  try {
    const params = new URLSearchParams({ To: TWILIO_TO_NUMBER, From: TWILIO_FROM_NUMBER, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!r.ok) console.error("Twilio (sync-meta-leads):", await r.text());
    return r.ok;
  } catch (e) {
    console.error("sendSms (sync-meta-leads):", e.message);
    return false;
  }
}

function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("33")) return "+" + d;
  if (d.startsWith("0")) return "+33" + d.slice(1);
  return "+" + d;
}

// Transforme field_data de Meta en champs SalesFlow. Tout ce qui n'est pas
// reconnu (questions personnalisées du formulaire) part dans les notes.
function mapFields(fieldData) {
  const out = { extras: [] };
  for (const f of fieldData || []) {
    const name = String(f.name || "").toLowerCase();
    const val = (f.values || []).join(", ").trim();
    if (!val) continue;
    if (name === "full_name") out.full_name = val;
    else if (name === "first_name" || name === "prénom" || name === "prenom") out.prenom = val;
    else if (name === "last_name" || name === "nom") out.nom = val;
    else if (name.includes("phone") || name.includes("téléphone") || name.includes("telephone")) out.telephone = val;
    else if (name.includes("email")) out.email = val;
    else if (name.includes("post") || name.includes("zip") || name.includes("code_postal")) out.code_postal = val;
    else if (name === "city" || name.includes("ville")) out.ville = val;
    else out.extras.push(`${f.name.replace(/_/g, " ")} : ${val}`);
  }
  if (!out.nom && out.full_name) {
    const parts = out.full_name.split(/\s+/);
    if (parts.length > 1 && !out.prenom) {
      out.prenom = parts.shift();
      out.nom = parts.join(" ");
    } else out.nom = out.full_name;
  }
  return out;
}

// Devine le type de projet depuis le nom du formulaire / de la campagne
function devinerProjet(texte) {
  const t = String(texte || "").toLowerCase();
  if (t.includes("portail")) return "portail";
  if (t.includes("résine") || t.includes("resine") || t.includes("epdm") || t.includes("catalogue")) return "resine";
  if (t.includes("assainissement") || t.includes("anc") || t.includes("fosse")) return "assainissement";
  return null;
}

export default async function handler(req, res) {
  if (!SYNC_SECRET || req.query.key !== SYNC_SECRET) return res.status(401).json({ ok: false, error: "clé invalide" });
  if (!META_PAGE_TOKEN) return res.status(500).json({ ok: false, error: "META_PAGE_TOKEN manquant sur Vercel" });

  const jours = Math.min(parseFloat(req.query.jours) || 1, 90);
  const depuis = Math.floor(Date.now() / 1000 - jours * 86400);
  const rapport = { ok: true, formulaires: 0, vus: 0, nouveaux: 0, mis_a_jour: 0, liens_envoyes: [], erreurs: [] };

  // Mode « relancer » : envoie le lien aux prospects Meta déjà en base qui ne
  // l'ont jamais reçu et n'ont pas complété de formulaire.
  if (req.query.relancer === "1") {
    try {
      const cibles = await sb(`leads?canal=eq.Meta&meta_lead_id=not.is.null&lien_envoye_at=is.null&or=(formulaire_complete.is.null,formulaire_complete.eq.false)&select=id,prenom,nom,telephone,email,type_projet`);
      for (const l of cibles || []) rapport.liens_envoyes.push(await envoyerLien(l));
    } catch (e) {
      rapport.erreurs.push(e.message);
    }
    return res.status(200).json(rapport);
  }

  try {
    // Le jeton de l'utilisateur système sert à obtenir le jeton propre à la
    // Page (indispensable pour lire formulaires et prospects).
    TOKEN = META_PAGE_TOKEN;
    try {
      const p = await graph(`${META_PAGE_ID}?fields=access_token`);
      if (p.access_token) TOKEN = p.access_token;
    } catch (e) {
      try {
        const acc = await graph(`me/accounts?fields=id,access_token&limit=100`);
        const pg = (acc.data || []).find((x) => x.id === META_PAGE_ID);
        if (pg && pg.access_token) TOKEN = pg.access_token;
      } catch (e2) {}
    }
    const forms = await graph(`${META_PAGE_ID}/leadgen_forms?fields=id,name,status&limit=100`);
    for (const form of forms.data || []) {
      rapport.formulaires++;
      const filtre = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: depuis }]));
      let url = `${form.id}/leads?fields=id,created_time,field_data,ad_name,campaign_name&limit=100&filtering=${filtre}`;
      while (url) {
        const page = await graph(url);
        for (const lead of page.data || []) {
          rapport.vus++;
          try {
            const deja = await sb(`leads?meta_lead_id=eq.${lead.id}&select=id`);
            if (deja && deja.length) continue;

            const f = mapFields(lead.field_data);
            const tel = toE164(f.telephone);
            const notes = [
              `Formulaire Meta : ${form.name}`,
              lead.campaign_name ? `Campagne : ${lead.campaign_name}` : null,
              f.ville ? `Ville : ${f.ville}` : null,
              ...f.extras,
            ].filter(Boolean).join("\n");

            const payload = {
              nom: f.nom || "Prospect Meta",
              prenom: f.prenom || null,
              email: f.email || null,
              code_postal: f.code_postal || null,
              adresse_projet: f.ville || null,
              type_projet: devinerProjet(`${form.name} ${lead.campaign_name || ""}`),
              source: "Formulaire Meta",
              canal: "Meta",
              utm_campaign: lead.campaign_name || null,
              meta_lead_id: lead.id,
              meta_form_name: form.name,
              notes,
            };

            let existant = null;
            if (tel) {
              const r = await sb(`leads?telephone=eq.${encodeURIComponent(tel)}&select=id,formulaire_complete`);
              existant = r && r[0];
            }
            let fiche;
            if (existant) {
              fiche = (await sb(`leads?id=eq.${existant.id}`, { method: "PATCH", body: JSON.stringify(payload) }))[0];
              rapport.mis_a_jour++;
            } else {
              fiche = (await sb("leads", {
                method: "POST",
                body: JSON.stringify({ ...payload, telephone: tel, statut: "nouveau", created_at: lead.created_time }),
              }))[0];
              rapport.nouveaux++;
            }
            if (AUTO_LIEN && jours <= 1 && fiche && !(existant && existant.formulaire_complete)) {
              rapport.liens_envoyes.push(await envoyerLien(fiche));
            }

            // Pas de SMS pour un rattrapage d'historique (jours > 1)
            if (jours <= 1) {
              const nomAff = [f.prenom, f.nom].filter(Boolean).join(" ") || "Prospect";
              const msg = `🔔 Nouveau prospect META (${form.name})\n${nomAff}\n${f.telephone || "pas de tél."}${f.code_postal ? " - " + f.code_postal : ""}${f.ville ? " " + f.ville : ""}\nVoir : salesflow-ecosky.vercel.app/sms-recus.html`;
              const okSms = await sendSms(msg);
              await logSms({ sms_type: "nouveau_prospect_meta", destinataire: TWILIO_TO_NUMBER, source: "Meta", utm_campaign: lead.campaign_name || null, message_body: msg, twilio_success: okSms });
            }
          } catch (e) {
            rapport.erreurs.push(`${lead.id}: ${e.message}`);
          }
        }
        const next = page.paging && page.paging.next;
        url = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "").replace(/&?access_token=[^&]+/, "") : null;
      }
    }
  } catch (e) {
    console.error("sync-meta-leads:", e.message);
    return res.status(500).json({ ...rapport, ok: false, error: e.message });
  }
  try {
    await rafraichirStatutsLiens();
  } catch (e) {
    rapport.erreurs.push(`statuts: ${e.message}`);
  }
  return res.status(200).json(rapport);
}
