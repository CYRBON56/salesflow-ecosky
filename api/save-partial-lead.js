// api/save-partial-lead.js
// Appelé dès que le visiteur du formulaire d'estimation renseigne son
// téléphone (tôt dans le parcours, avant d'avoir répondu à toutes les
// questions). Ça permet de le recontacter par SMS s'il abandonne le
// formulaire en cours de route — sans ça, ces prospects seraient
// définitivement perdus, aucune trace d'eux n'existant nulle part.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("33")) return "+" + digits;
  if (digits.startsWith("0")) return "+33" + digits.slice(1);
  return "+" + digits;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { nom, prenom, telephone, type_projet } = req.body || {};
    if (!nom || !telephone) {
      return res.status(400).json({ success: false, error: "Nom et téléphone requis." });
    }

    const phoneE164 = toE164(telephone);
    const existing = await supabaseRequest(`leads?telephone=eq.${encodeURIComponent(phoneE164)}`);

    let lead;
    if (existing && existing.length > 0) {
      // Déjà un dossier pour ce numéro (test précédent, contact antérieur) :
      // on ne l'écrase pas complètement, juste les infos de base.
      lead = await supabaseRequest(`leads?telephone=eq.${encodeURIComponent(phoneE164)}`, {
        method: "PATCH",
        body: JSON.stringify({ nom, prenom: prenom || null, type_projet: type_projet || null }),
      });
    } else {
      lead = await supabaseRequest("leads", {
        method: "POST",
        body: JSON.stringify({
          nom,
          prenom: prenom || null,
          telephone: phoneE164,
          type_projet: type_projet || null,
          source: "Formulaire estimation détaillée",
          statut: "nouveau",
          formulaire_complete: false,
          notes: "",
        }),
      });
    }

    return res.status(200).json({ success: true, lead_id: lead?.[0]?.id });
  } catch (err) {
    console.error("save-partial-lead error:", err.message);
    // On ne bloque jamais la navigation du visiteur pour un souci d'enregistrement
    return res.status(200).json({ success: false });
  }
}
