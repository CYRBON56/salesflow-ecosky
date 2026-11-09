/**
 * api/leads-anc-en-attente.js
 *
 * Retourne la liste des demandes ANC en attente de validation technicien
 * (estimation_validee = false), triées de la plus récente à la plus ancienne.
 * Utilisé par public/valider-anc.html.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseAnc = createClient(
  process.env.SUPABASE_ANC_URL,
  process.env.SUPABASE_ANC_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const { data: leads, error } = await supabaseAnc
      .from("leads_anc")
      .select("*")
      .eq("estimation_validee", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.status(200).json({ ok: true, leads: leads || [] });
  } catch (err) {
    console.error("leads-anc-en-attente error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
}
