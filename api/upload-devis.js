import { createClient } from "@supabase/supabase-js";

// Réutilise les mêmes variables d'environnement que le reste du site résine.
// Si tes noms de variables Supabase diffèrent (vérifie sur Vercel), adapte les deux lignes ci-dessous.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { lead_id, numero, montant_ttc, pdf_base64, filename } = req.body;

    if (!lead_id || !numero || !pdf_base64 || !filename) {
      return res.status(400).json({ error: "Champs manquants (lead_id, numero, pdf_base64, filename requis)" });
    }

    const buffer = Buffer.from(pdf_base64, "base64");
    const storagePath = `devis/${numero.replace(/[^a-zA-Z0-9_-]/g, "_")}_${filename}`;

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Erreur upload storage:", uploadError);
      return res.status(500).json({ error: "Échec de l'upload du PDF" });
    }

    const { data: publicUrlData } = supabase.storage.from("media").getPublicUrl(storagePath);
    const pdf_url = publicUrlData.publicUrl;

    const { data: devisRow, error: insertError } = await supabase
      .from("devis")
      .insert({
        lead_id,
        numero,
        pdf_url,
        montant_ttc: montant_ttc || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erreur insertion devis:", insertError);
      return res.status(500).json({ error: "Échec de l'enregistrement du devis" });
    }

    return res.status(200).json({ devis_id: devisRow.id, pdf_url });
  } catch (err) {
    console.error("Erreur upload-devis:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
