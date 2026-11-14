// api/voix-ia.js
// Secrétaire téléphonique IA de RMS EcoSky.
// Quand Cyrille ne décroche pas, son portable renvoie l'appel vers le numéro
// Twilio. Twilio appelle ce webhook : l'assistante répond à voix haute, écoute
// la personne (reconnaissance vocale Twilio en français), et Claude (Haiku)
// décide de la réponse suivante. À la fin, la demande est enregistrée dans la
// table leads (source "telephone_ia"), Cyrille reçoit un SMS de résumé et
// l'appelant un SMS de confirmation.
//
// Étapes (paramètre ?etape=) :
//   (aucune) : début d'appel → message d'accueil + écoute
//   tour     : la personne a parlé (SpeechResult) → réponse de l'IA
//   fin      : rappel de statut Twilio (appel terminé) → on envoie le résumé
//              même si la personne a raccroché en cours de route
//
// Sécurité : chaque requête est vérifiée avec la signature Twilio
// (X-Twilio-Signature + TWILIO_AUTH_TOKEN).

import crypto from "crypto";
import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER; // portable de Cyrille

const MODELE = "claude-haiku-5-5";
const VOIX = "Polly.Lea-Neural";
const MAX_TOURS = 14;
// Mots attendus : aident la reconnaissance vocale Twilio
const INDICES =
  "devis, portail, portail coulissant, portail battant, autoportant, motorisé, assainissement, fosse septique, micro-station, filtre compact, easyRock, SPANC, résine, terrasse, piscine, allée, eau de pluie, cuve, Brech, Auray, Vannes, Lorient, Carnac, Quiberon, Pluneret, Erdeven, Locoal-Mendon, Plouharnel";

const CONSIGNES = `Tu es l'assistante téléphonique de RMS EcoSky (EcoSky by RMS), entreprise de Cyrille Bon
à Brech (Morbihan, 56400). Tu réponds AU TÉLÉPHONE, à l'oral, quand Cyrille ne peut pas décrocher.

Ce que fait RMS EcoSky :
- portails aluminium autoportés et coulissants, battants, avec pose et motorisation possible ;
- assainissement non collectif (filtre compact GRAF easyRock, micro-stations), terrassement ;
- sols en résine EPDM drainante EcoSky'Gum (terrasses, plages de piscine, allées) ;
- récupération d'eau de pluie.
Zone d'intervention : Morbihan (56) en priorité, Finistère (29), Côtes-d'Armor (22), Ille-et-Vilaine (35),
et parfois Loire-Atlantique (44).

TON RÔLE : prendre la demande pour que Cyrille rappelle. Recueille, une question à la fois :
1. le motif (nouveau projet, client existant, fournisseur, autre) ;
2. le type de projet et 1 ou 2 détails utiles (ex. portail : largeur, coulissant/battant, motorisé ;
   assainissement : maison existante ou neuve, étude de sol faite ou non ; résine : surface en m²) ;
3. la commune du chantier ;
4. le nom de la personne ;
5. le meilleur numéro pour la rappeler (si c'est le numéro qui appelle, il suffit qu'elle confirme) ;
6. quand la rappeler et si c'est urgent.

RÈGLES :
- La transcription de la voix peut contenir des erreurs (mots mal entendus). Devine le sens le plus probable.
- Si la personne n'a pas compris (« pardon ? », « dans quoi ? », « vous pouvez répéter ? »), reformule
  simplement la même question, plus courte. Ce n'est pas une répétition interdite.
- Si une RÉPONSE est incompréhensible ou ne ressemble pas à ce qui est demandé (ex. un mot bizarre au lieu
  d'une commune), demande UNE fois de la redire ou de l'épeler (« Excusez-moi, la ligne coupe un peu, vous
  pouvez me redire la commune ? »). Si c'est encore flou, note ce que tu as entendu dans "details"
  et passe à la question suivante. Ne pose jamais une troisième fois la même question.
- Ne termine JAMAIS l'appel parce qu'une réponse est floue. Continue jusqu'au nom et au rappel,
  sauf si la personne dit au revoir, refuse de répondre ou est un démarcheur.
- Phrases très courtes et naturelles (c'est lu à voix haute) : 1 à 2 phrases, 30 mots maximum.
- Vouvoiement, ton chaleureux d'une petite entreprise bretonne. Pas de listes, pas d'émojis, pas d'abréviations.
- Ne donne JAMAIS de prix, de délai ferme ou d'engagement : « Cyrille vous fera une proposition précise ».
- N'invente rien. Si on te demande quelque chose que tu ne sais pas, dis que Cyrille rappellera pour répondre.
- Démarcheur, vendeur, sondage ou publicité : remercie poliment, dis que tu transmets, et termine l'appel.
- Si la personne veut parler à Cyrille tout de suite ou que c'est une urgence : dis que tu le préviens
  immédiatement par SMS et qu'il rappelle dès que possible.
- Quand tu as l'essentiel (au minimum le motif, un nom et un moyen de rappeler), récapitule en une phrase,
  dis que Cyrille rappelle et qu'un SMS de confirmation va être envoyé, puis termine.
- Si la personne dit au revoir ou n'a plus rien à ajouter, termine.
- Ne dis JAMAIS que tu es une assistante virtuelle, une IA ou un robot. Présente-toi simplement comme la personne
  qui prend les appels de RMS EcoSky. Si on te demande directement si tu es un robot, réponds honnêtement
  que oui, en une phrase, puis reprends la demande.
- Oriente la personne : devis en cours (demande le nom ou la commune du chantier pour que Cyrille retrouve le dossier),
  nouveau projet (questions ci-dessus), autre demande (note-la). Dis « je transmets à Cyrille et il revient vers vous ».

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"reponse": "ce que tu dis à voix haute",
 "termine": true ou false,
 "fiche": {"motif": "", "type_projet": "", "details": "", "commune": "", "code_postal": "",
           "nom": "", "telephone_rappel": "", "quand_rappeler": "", "urgent": false, "demarcheur": false}}
Dans "fiche", remets à chaque fois TOUT ce que tu sais déjà (laisse "" si inconnu).`;

// ---------- utilitaires ----------

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
  const rows = await sb(`appels_ia?call_sid=eq.${encodeURIComponent(callSid)}&select=*`);
  return rows && rows[0];
}

async function enregistrerAppel(appel) {
  appel.updated_at = new Date().toISOString();
  await sb("appels_ia?on_conflict=call_sid", {
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
    if (!ok) console.error("voix-ia SMS:", await res.text());
  } catch (e) {
    console.error("voix-ia SMS:", e.message);
  }
  await logSms({ sms_type: type, destinataire: to, source: "telephone_ia", message_body: body, twilio_success: ok });
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
      max_tokens: 400,
      system: CONSIGNES,
      messages: historique,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const texte = (data.content || []).map((c) => c.text || "").join("");
  const json = texte.slice(texte.indexOf("{"), texte.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// ---------- TwiML ----------

function twimlEcoute(req, texte) {
  const action = `${baseUrl(req)}/api/voix-ia?etape=tour`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="fr-FR" speechTimeout="auto" timeout="7" hints="${xml(INDICES)}" action="${xml(action)}" method="POST">
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

// ---------- fin d'appel : lead + SMS ----------

async function cloturer(appel) {
  if (appel.notifie) return;
  const f = appel.fiche || {};
  const appelant = toE164(appel.appelant);
  const rappel = toE164(f.telephone_rappel) || appelant;
  const aParle = (appel.historique || []).some((m) => m.role === "user" && !String(m.content).startsWith("[silence"));

  // Lead dans SalesFlow (sauf démarcheur ou appel vide)
  let leadId = appel.lead_id || null;
  if (!leadId && aParle && !f.demarcheur) {
    try {
      const notes = [
        f.motif && `Motif : ${f.motif}`,
        f.details && `Détails : ${f.details}`,
        f.quand_rappeler && `À rappeler : ${f.quand_rappeler}`,
        f.urgent && "URGENT",
        `Appel reçu par la secrétaire IA (${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })})`,
      ]
        .filter(Boolean)
        .join("\n");
      // Le numéro est peut-être déjà connu (client qui rappelle) : on complète sa fiche
      const existants = rappel
        ? await sb(`leads?telephone=eq.${encodeURIComponent(rappel)}&select=id,notes`)
        : [];
      if (existants && existants[0]) {
        const ancien = existants[0];
        await sb(`leads?id=eq.${ancien.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify({
            notes: [ancien.notes, notes].filter(Boolean).join("\n\n"),
            callback_demande: true,
            callback_demande_le: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
        leadId = ancien.id;
      } else {
        const rows = await sb("leads", {
          method: "POST",
          body: JSON.stringify({
            nom: f.nom || "Appel téléphonique",
            telephone: rappel,
            source: "telephone_ia",
            statut: "nouveau",
            type_projet: f.type_projet || null,
            code_postal: f.code_postal || null,
            adresse_projet: f.commune || null,
            notes,
            callback_demande: true,
            callback_demande_le: new Date().toISOString(),
          }),
        });
        leadId = rows && rows[0] && rows[0].id;
      }
    } catch (e) {
      console.error("voix-ia lead:", e.message);
    }
  }

  // SMS de résumé à Cyrille
  const resume = aParle
    ? [
        f.demarcheur ? "Démarcheur (rien à faire)" : f.urgent ? "URGENT – appel manqué" : "Appel manqué",
        f.nom && `de ${f.nom}`,
        rappel && `Tél : ${rappel}`,
        f.type_projet && `Projet : ${f.type_projet}`,
        f.commune && `À : ${f.commune}`,
        f.details && `Détails : ${f.details}`,
        f.quand_rappeler && `Rappeler : ${f.quand_rappeler}`,
      ]
        .filter(Boolean)
        .join(" – ")
    : `Appel manqué sans message${appelant ? ` – ${appelant}` : ""}`;
  await envoyerSms(TWILIO_TO_NUMBER, `Secrétaire RMS : ${resume}`.slice(0, 600), "secretaire_ia_cyrille");

  // SMS de confirmation à l'appelant (portable uniquement, vraie demande)
  if (aParle && !f.demarcheur && estMobile(rappel)) {
    await envoyerSms(
      rappel,
      "RMS EcoSky : merci pour votre appel, votre demande est bien transmise à Cyrille Bon qui vous rappelle rapidement. Tél : 06 45 68 83 94",
      "secretaire_ia_confirmation"
    );
  }

  appel.notifie = true;
  appel.termine = true;
  appel.lead_id = leadId;
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
    // Rappel de statut (appel terminé) : on envoie le résumé si pas encore fait
    if (etape === "fin") {
      const appel = await lireAppel(callSid);
      if (appel) await cloturer(appel);
      else if (p.From) await cloturer({ call_sid: callSid, appelant: p.From, historique: [], fiche: {} });
      return res.status(200).send("<Response/>");
    }

    // Début d'appel
    if (etape === "debut") {
      const accueil =
        "Bonjour, R M S EcoSky, j'écoute. Cyrille n'est pas disponible pour le moment, je prends votre demande et je vais essayer de vous orienter. C'est pour un devis en cours, un nouveau projet, ou autre chose ?";
      await enregistrerAppel({
        call_sid: callSid,
        appelant: p.From || null,
        historique: [{ role: "assistant", content: JSON.stringify({ reponse: accueil, termine: false, fiche: {} }) }],
        fiche: {},
      });
      return res.status(200).send(twimlEcoute(req, accueil));
    }

    // Tour de conversation
    const appel = (await lireAppel(callSid)) || {
      call_sid: callSid,
      appelant: p.From || null,
      historique: [],
      fiche: {},
      silences: 0,
    };
    const parole = String(p.SpeechResult || "").trim();

    if (!parole) {
      appel.silences = (appel.silences || 0) + 1;
      if (appel.silences >= 2) {
        await enregistrerAppel(appel);
        await cloturer(appel);
        return res
          .status(200)
          .send(twimlFin("Je n'entends rien, je préviens Cyrille de votre appel, il vous rappelle. Au revoir."));
      }
      await enregistrerAppel(appel);
      return res.status(200).send(twimlEcoute(req, "Excusez-moi, je ne vous ai pas entendu. Pouvez-vous répéter ?"));
    }

    appel.historique = [...(appel.historique || []), { role: "user", content: parole }];
    const nbTours = appel.historique.filter((m) => m.role === "user").length;

    let ia;
    try {
      // L'historique commence par l'accueil (assistant) : Claude veut un premier message utilisateur
      const msgs = appel.historique[0] && appel.historique[0].role === "assistant"
        ? [{ role: "user", content: "[l'appel commence]" }, ...appel.historique]
        : appel.historique;
      ia = await demanderAClaude(msgs);
    } catch (e) {
      console.error("voix-ia Claude:", e.message);
      ia = {
        reponse: "Je note votre demande et je préviens Cyrille tout de suite, il vous rappelle très vite. Au revoir.",
        termine: true,
        fiche: appel.fiche,
      };
    }

    appel.fiche = { ...(appel.fiche || {}), ...(ia.fiche || {}) };
    appel.historique.push({ role: "assistant", content: JSON.stringify(ia) });
    const fini = ia.termine || nbTours >= MAX_TOURS;
    await enregistrerAppel(appel);

    if (fini) {
      await cloturer(appel);
      return res.status(200).send(twimlFin(ia.reponse || "Merci, Cyrille vous rappelle. Au revoir."));
    }
    return res.status(200).send(twimlEcoute(req, ia.reponse));
  } catch (e) {
    console.error("voix-ia:", e.message);
    return res
      .status(200)
      .send(twimlFin("Désolée, un petit souci technique. Cyrille a bien été prévenu de votre appel et vous rappelle. Au revoir."));
  }
}
