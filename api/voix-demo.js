// api/voix-demo.js
// Agent de DÉMONSTRATION de Mon Assistant Pro (Skyeco), sur une ligne dédiée.
// Les prospects appellent pour essayer : l'agent répond à leurs questions (fonctions, prix),
// récupère prénom / métier / entreprise / numéro, puis propose l'inscription (lien par SMS)
// ou un rappel par l'équipe Skyeco. Résumé par SMS à Cyrille + demande dans l'administration
// Skyeco (map_rappels via la fonction map_demande_rappel, qui envoie aussi un mail à infos@).
// Même mécanique que api/voix-ia.js (Twilio Gather + Claude Haiku), table appels_demo.

import crypto from "crypto";
import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;
const MODELE = "claude-haiku-5-5";
const VOIX = "Polly.Remi-Neural";
const MAX_TOURS = 20;
const INDICES = "Mon Assistant Pro, Skyeco, forfait, Starter, Pro, Premium, prix, tarif, essai, devis, factures, Pennylane, Dropbox, Google Drive, Gmail, Outlook, Facebook, Instagram, TikTok, artisan, plombier, électricien, paysagiste, maçon, menuisier, peintre, couvreur, carreleur, rappel, inscription";
const ACCUEIL = "Bonjour, ici l'assistant de démonstration de Mon Assistant Pro, par Skyeco. Vous êtes en train de l'essayer en vrai : c'est comme ça que je réponds aux clients d'un artisan quand il est sur le chantier. Posez-moi vos questions, je vous écoute.";
const CONSIGNES = "Tu es l'agent de démonstration téléphonique de « Mon Assistant Pro », par Skyeco (skyeco.fr). Tu es un homme, chaleureux, clair, rassurant, et tu parles français simple, comme au téléphone avec un artisan ou un chef d'entreprise. Phrases courtes (2 ou 3 maximum par réponse, même si on te pose plusieurs questions d'un coup : réponds à la première et propose de détailler la suite), pas de listes, pas d'anglicismes. Tu ne dis jamais que tu es « virtuel », mais si on te demande si tu es une IA, tu réponds honnêtement : oui, c'est justement ce que fait Mon Assistant Pro.\n\nTON BUT : montrer en vrai comment l'assistant répond au téléphone, répondre aux questions, donner envie d'essayer, et récupérer le prénom, le métier et l'entreprise de la personne. Termine en l'invitant à créer son compte sur skyeco.fr (essai gratuit) ou à être rappelé par l'équipe Skyeco.\n\nCE QU'EST MON ASSISTANT PRO (ne rien inventer au-delà) :\n- C'est une secrétaire, un commercial et un agent marketing dans le téléphone de l'artisan ou de la petite entreprise.\n- Secrétaire : il répond au téléphone quand l'artisan ne peut pas décrocher (sur le chantier), prend la demande, pose les bonnes questions, et envoie un SMS de résumé à l'artisan. Il reconnaît les proches (famille, amis) et prend juste leur message. Il trie les mails : pubs et spams à la corbeille, l'important mis en avant.\n- Commercial : devis dictés à la voix sur le chantier, relance des devis en attente et des factures impayées, suivi des demandes.\n- Documents : il range devis, factures et photos par client dans Dropbox ou Google Drive, avec un journal.\n- Marketing : il prépare des publications Facebook, Instagram, TikTok (par exemple un avant/après de chantier), l'artisan valide d'un clic.\n- Il se branche sur les outils existants : Gmail, Outlook, Google Agenda, Pennylane, Dropbox, Google Drive, banque. Rien ne part sans l'accord de l'artisan.\n- Mise en route en 15 minutes environ ; l'équipe Skyeco peut aider à tout brancher, à distance ou par rendez-vous.\n- Tarifs hors taxes par mois, sans engagement : Starter 89 euros (50 appels inclus), Pro 159 euros (120 appels inclus, réseaux sociaux), Premium 279 euros (300 appels inclus, publicité et prospection). Au-delà : 50 centimes hors taxes par appel. Essai gratuit pour tester.\n- Pour s'inscrire : sur skyeco point f r, rubrique Mon Assistant Pro.\nSi on te pose une question dont la réponse n'est pas ici, dis honnêtement que tu préfères que l'équipe Skyeco lui réponde précisément, et propose un rappel.\n\nDÉROULÉ :\n1. L'accueil est déjà dit. Écoute ce que la personne veut savoir et réponds.\n2. Au fil de la conversation, demande naturellement (pas tout d'un coup) : son prénom, son métier, son entreprise, et combien d'appels environ elle reçoit ou rate par semaine.\n3. Propose le forfait le plus adapté selon ce qu'elle dit, sans pousser.\n4. Avant de finir, demande si elle préfère créer son compte elle-même (on lui envoie le lien par SMS) ou être rappelée par l'équipe Skyeco (demande alors le moment qui l'arrange). Si elle appelle d'un fixe, demande un numéro de portable pour le SMS.\n5. Quand c'est fini, remercie, dis au revoir et mets \"termine\": true. Ne termine jamais sur une réponse floue : reformule une fois si tu n'as pas compris.\n\nRÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte autour :\n{\"reponse\": \"ce que tu dis à voix haute\",\n \"termine\": true ou false,\n \"fiche\": {\"prenom\": \"\", \"nom\": \"\", \"metier\": \"\", \"entreprise\": \"\", \"commune\": \"\", \"appels_semaine\": \"\",\n           \"forfait_conseille\": \"\", \"questions\": \"\", \"suite\": \"\", \"quand_rappeler\": \"\", \"telephone_sms\": \"\", \"interesse\": \"\"}}\n\"suite\" vaut \"inscription\", \"rappel\" ou \"rien\". \"interesse\" vaut \"oui\", \"peut-être\" ou \"non\". Dans \"fiche\", remets à chaque fois TOUT ce que tu sais déjà (laisse \"\" si inconnu).";

function xml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

function signatureValide(req) {
  if (!TWILIO_AUTH_TOKEN) return false;
  const sig = req.headers["x-twilio-signature"];
  if (!sig) return false;
  const url = baseUrl(req) + req.url;
  const params = req.body && typeof req.body === "object" ? req.body : {};
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const attendu = crypto.createHmac("sha1", TWILIO_AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu));
  } catch {
    return false;
  }
}

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function lireAppel(callSid) {
  const rows = await sb(`appels_demo?call_sid=eq.${encodeURIComponent(callSid)}&select=*`);
  return rows && rows[0];
}

async function enregistrerAppel(appel) {
  appel.updated_at = new Date().toISOString();
  await sb("appels_demo?on_conflict=call_sid", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify(appel),
  });
}

async function envoyerSms(to, body, type) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) return false;
  let ok = false;
  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body }).toString(),
    });
    ok = res.ok;
    if (!ok) console.error("voix-demo SMS:", await res.text());
  } catch (e) {
    console.error("voix-demo SMS:", e.message);
  }
  await logSms({ sms_type: type, destinataire: to, source: "demo_tel", message_body: body, twilio_success: ok });
  return ok;
}

function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("33")) return "+" + d;
  if (d.startsWith("0") && d.length === 10) return "+33" + d.slice(1);
  return null;
}

function estMobile(e164) {
  return /^\+33[67]\d{8}$/.test(e164 || "");
}

async function demanderAClaude(historique) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 1200,
      system: CONSIGNES,
      messages: historique,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const texte = (data.content || []).map((c) => c.text || "").join("");
  const json = texte.slice(texte.indexOf("{"), texte.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    // Réponse coupée ou mal formée : on garde au moins la phrase à dire, sans couper l'appel
    const m = texte.match(/"reponse"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const dire = m ? m[1].replace(/\\n/g, " ").replace(/\\"/g, '"') : texte.replace(/[{}"]/g, " ").trim().slice(0, 400);
    if (!dire) throw e;
    return { reponse: dire, termine: false, fiche: {} };
  }
}


// ---------- TwiML ----------
function twimlEcoute(req, texte) {
  const action = `${baseUrl(req)}/api/voix-demo?etape=tour`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="fr-FR" speechTimeout="auto" timeout="8" hints="${xml(INDICES)}" action="${xml(action)}" method="POST">
    <Say voice="${VOIX}" language="fr-FR">${xml(texte)}</Say>
  </Gather>
  <Redirect method="POST">${xml(action)}</Redirect>
</Response>`;
}
function twimlFin(texte) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOIX}" language="fr-FR">${xml(texte)}</Say>
  <Hangup/>
</Response>`;
}

// ---------- fin d'appel ----------
async function cloturer(appel) {
  if (appel.notifie) return;
  const f = appel.fiche || {};
  const appelant = toE164(appel.appelant);
  const portable = toE164(f.telephone_sms) || appelant;
  const aParle = (appel.historique || []).some((m) => m.role === "user" && !String(m.content).startsWith("[silence"));
  const qui = [f.prenom, f.nom].filter(Boolean).join(" ") || "Prospect démo";
  const resume = aParle
    ? [
        `DÉMO Mon Assistant Pro – ${qui}`,
        f.metier,
        f.entreprise && `(${f.entreprise})`,
        f.commune,
        `Tél : ${portable || "?"}`,
        f.interesse && `Intéressé : ${f.interesse}`,
        f.forfait_conseille && `Forfait : ${f.forfait_conseille}`,
        f.suite && `Suite : ${f.suite}${f.quand_rappeler ? " " + f.quand_rappeler : ""}`,
        f.questions && `Questions : ${f.questions}`,
      ].filter(Boolean).join(" · ")
    : `DÉMO Mon Assistant Pro : appel sans échange${appelant ? " – " + appelant : ""}`;
  await envoyerSms(TWILIO_TO_NUMBER, resume.slice(0, 600), "demo_map_cyrille");

  if (aParle && portable) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/map_demande_rappel`, {
        method: "POST",
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_nom: qui,
          p_entreprise: [f.entreprise, f.metier].filter(Boolean).join(" – "),
          p_telephone: portable,
          p_creneau: f.suite === "rappel" ? (f.quand_rappeler || "à rappeler") : (f.suite === "inscription" ? "s'inscrit seul (lien envoyé)" : "démo téléphonique"),
          p_message: ["Appel à la ligne de démonstration.", f.interesse && `Intéressé : ${f.interesse}`, f.forfait_conseille && `Forfait conseillé : ${f.forfait_conseille}`, f.appels_semaine && `Appels/semaine : ${f.appels_semaine}`, f.questions && `Questions : ${f.questions}`].filter(Boolean).join("\n"),
          p_source: "demo_tel",
        }),
      });
    } catch (e) { console.error("voix-demo rappel:", e.message); }
  }

  if (aParle && estMobile(portable) && f.interesse !== "non") {
    const txt = f.suite === "rappel"
      ? "Skyeco : merci pour votre appel ! L'équipe vous rappelle comme convenu. Découvrir Mon Assistant Pro : https://www.skyeco.fr/mon-assistant-pro/?src=demo-tel"
      : "Skyeco : merci d'avoir essayé Mon Assistant Pro ! Créez votre compte (essai gratuit) : https://www.skyeco.fr/mon-assistant-pro/?src=demo-tel";
    await envoyerSms(portable, txt, "demo_map_prospect");
  }
  appel.notifie = true;
  appel.termine = true;
  await enregistrerAppel(appel);
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Méthode non autorisée");
  if (!signatureValide(req)) return res.status(403).send("Signature invalide");
  const etape = (req.query && req.query.etape) || "debut";
  const p = req.body || {};
  const callSid = p.CallSid;
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  try {
    if (etape === "fin") {
      const appel = await lireAppel(callSid);
      if (appel) await cloturer(appel);
      return res.status(200).send("<Response/>");
    }
    if (etape === "debut") {
      await enregistrerAppel({ call_sid: callSid, appelant: p.From || null, numero_appele: p.To || null,
        historique: [{ role: "assistant", content: JSON.stringify({ reponse: ACCUEIL, termine: false, fiche: {} }) }], fiche: {} });
      return res.status(200).send(twimlEcoute(req, ACCUEIL));
    }
    const appel = (await lireAppel(callSid)) || { call_sid: callSid, appelant: p.From || null, historique: [], fiche: {}, silences: 0 };
    const parole = String(p.SpeechResult || "").trim();
    if (!parole) {
      appel.silences = (appel.silences || 0) + 1;
      if (appel.silences >= 2) {
        await enregistrerAppel(appel); await cloturer(appel);
        return res.status(200).send(twimlFin("Je ne vous entends plus. Retrouvez Mon Assistant Pro sur skyeco point f r. À bientôt !"));
      }
      await enregistrerAppel(appel);
      return res.status(200).send(twimlEcoute(req, "Pardon, je ne vous ai pas entendu. Vous pouvez répéter ?"));
    }
    appel.historique = [...(appel.historique || []), { role: "user", content: parole }];
    const nbTours = appel.historique.filter((m) => m.role === "user").length;
    let ia;
    try {
      const msgs = appel.historique[0] && appel.historique[0].role === "assistant" ? [{ role: "user", content: "[l'appel commence]" }, ...appel.historique] : appel.historique;
      ia = await demanderAClaude(msgs);
    } catch (e) {
      console.error("voix-demo Claude:", e.message);
      ia = { reponse: "Je note vos coordonnées, l'équipe Skyeco vous rappelle très vite. Au revoir !", termine: true, fiche: appel.fiche };
    }
    const nouv = Object.fromEntries(Object.entries(ia.fiche || {}).filter(([, v]) => v !== "" && v != null));
    appel.fiche = { ...(appel.fiche || {}), ...nouv };
    appel.historique.push({ role: "assistant", content: JSON.stringify(ia) });
    const fini = ia.termine || nbTours >= MAX_TOURS;
    await enregistrerAppel(appel);
    if (fini) { await cloturer(appel); return res.status(200).send(twimlFin(ia.reponse || "Merci et à bientôt sur skyeco point f r !")); }
    return res.status(200).send(twimlEcoute(req, ia.reponse));
  } catch (e) {
    console.error("voix-demo:", e.message);
    return res.status(200).send(twimlFin("Désolé, un petit souci technique. Retrouvez Mon Assistant Pro sur skyeco point f r. À bientôt !"));
  }
}
