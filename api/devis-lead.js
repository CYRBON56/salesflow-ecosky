import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Liste les devis déjà chargés pour un lead donné, du plus récent au plus ancien.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { lead_id } = req.query;
  if (!lead_id) {
    return res.status(400).json({ error: "lead_id requis" });
  }

  try {
    const { data, error } = await supabase
      .from("devis")
      .select("id, numero, pdf_url, nom_client, type_projet, message_perso, created_at, envoye_email_at, envoye_sms_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ ok: true, rows: data || [] });
  } catch (err) {
    console.error("Erreur devis-lead:", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur" });
  }
}
