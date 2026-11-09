// api/leads-admin.js
// Regroupe toutes les actions d'écriture "admin" du dashboard (modifier un
// lead, le supprimer, importer un CSV, changer les réglages) qui se
// faisaient auparavant DIRECTEMENT depuis le navigateur avec la clé anonyme
// Supabase — laquelle n'a aucune protection propre et est visible dans le
// code envoyé au navigateur. Désormais, ces écritures passent par ici, avec
// la clé service_role (jamais exposée au client), et cette route est
// protégée par le MÊME mot de passe que le dashboard (voir middleware.js à
// la racine — ce fichier n'est PAS exclu de la protection Basic Auth,
// contrairement aux autres routes /api/* qui doivent rester publiques pour
// les clients).

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { action } = req.body || {};

    if (action === "update_lead") {
      const { id, patch } = req.body;
      if (!id || !patch) return res.status(400).json({ success: false, error: "id et patch requis." });
      const dbPatch = { ...patch };
      if ("stage" in dbPatch) {
        dbPatch.statut = dbPatch.stage;
        delete dbPatch.stage;
      }
      await supabaseRequest(`leads?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify(dbPatch),
        prefer: "return=minimal",
      });
      return res.status(200).json({ success: true });
    }

    if (action === "delete_lead") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ success: false, error: "id requis." });
      await supabaseRequest(`leads?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
      return res.status(200).json({ success: true });
    }

    if (action === "import_leads") {
      const { leads } = req.body;
      if (!Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({ success: false, error: "leads (tableau) requis." });
      }
      const data = await supabaseRequest("leads", {
        method: "POST",
        body: JSON.stringify(leads),
      });
      return res.status(200).json({ success: true, data });
    }

    if (action === "update_settings") {
      const { row } = req.body;
      if (!row) return res.status(400).json({ success: false, error: "row requis." });
      await supabaseRequest(`settings?id=eq.1`, {
        method: "PATCH",
        body: JSON.stringify(row),
        prefer: "return=minimal",
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Action inconnue." });
  } catch (err) {
    console.error("leads-admin error:", err.message);
    return res.status(500).json({ success: false, error: "Une erreur technique est survenue." });
  }
}
