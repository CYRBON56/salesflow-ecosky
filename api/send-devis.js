import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import twilio from "twilio";
import crypto from "crypto";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
// Le RIB est un fichier statique servi par le site lui-même (public/rib-ecosky.pdf).
const RIB_URL = "https://salesflow-ecosky.vercel.app/rib-ecosky.pdf";
const SITE_URL = "https://salesflow-ecosky.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  try {
    const { devis_id, channels, message, inclure_rib } = req.body; // channels: ["email", "sms"]
    if (!devis_id || !Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ error: "Champs manquants (devis_id, channels)" });
    }
    const { data: devis, error: devisError } = await supabase
      .from("devis")
      .select("*, leads(prenom, nom, email, telephone)")
      .eq("id", devis_id)
      .single();
    if (devisError || !devis) {
      return res.status(404).json({ error: "Devis introuvable" });
    }
    const lead = devis.leads;
    const texteMessage = (message && message.trim())
      || devis.message_perso
      || `RMS EcoSky - Bonjour, voici votre devis${devis.numero ? ` n° ${devis.numero}` : ''}. Vous pouvez le consulter et le signer en ligne via le lien ci-dessous. À bientôt, l'équipe RMS EcoSky.`;

    // Lien de signature électronique (nécessite la migration sql-signature-devis.sql).
    // Si le devis n'a pas encore de token (ex: créé via l'ancien écran d'upload
    // sur sms-recus.html), on le génère et on le sauvegarde ici, à la volée.
    let tokenSignature = devis.token_signature;
    if (!tokenSignature) {
      tokenSignature = crypto.randomUUID();
      await supabase.from("devis").update({ token_signature: tokenSignature }).eq("id", devis_id);
    }
    const lienSignature = `${SITE_URL}/signature-devis.html?token=${tokenSignature}`;

    const results = { email: null, sms: null };
    // --- Email (via Resend), PDF du devis + RIB (si coché) en pièce jointe ---
    if (channels.includes("email")) {
      if (!lead?.email) {
        results.email = { sent: false, reason: "Pas d'email sur cette fiche" };
      } else {
        const pdfResponse = await fetch(devis.pdf_url);
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
        const attachments = [
          {
            filename: `Devis_${devis.numero || devis_id}.pdf`,
            content: pdfBuffer.toString("base64"),
          },
        ];
        if (inclure_rib) {
          const ribResponse = await fetch(RIB_URL);
          if (ribResponse.ok) {
            const ribBuffer = Buffer.from(await ribResponse.arrayBuffer());
            attachments.push({
              filename: "RIB-RMS-EcoSky.pdf",
              content: ribBuffer.toString("base64"),
            });
          }
        }
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: lead.email,
          bcc: process.env.OWNER_EMAIL,
          subject: `Votre devis RMS EcoSky${devis.numero ? ` n° ${devis.numero}` : ""}`,
          html: `
            <p>${texteMessage.replace(/\n/g, "<br>")}</p>
            ${lienSignature ? `<p><a href="${lienSignature}" style="background:#0f7a4a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Signer le devis en ligne</a></p>` : ""}
            <p>N'hésitez pas à nous contacter pour toute question.</p>
            <p>L'équipe RMS EcoSky</p>
          `,
          attachments,
        });
        await supabase.from("devis").update({ envoye_email_at: new Date().toISOString() }).eq("id", devis_id);
        results.email = { sent: true };
      }
    }
    // --- SMS (via Twilio), message personnalisé + lien devis + lien signature + lien RIB (si coché) ---
    if (channels.includes("sms")) {
      if (!lead?.telephone) {
        results.sms = { sent: false, reason: "Pas de téléphone sur cette fiche" };
      } else {
        let corps = `${texteMessage}\nDevis : ${devis.pdf_url}`;
        if (lienSignature) corps += `\nSigner : ${lienSignature}`;
        if (inclure_rib) corps += `\nRIB : ${RIB_URL}`;
        await twilioClient.messages.create({
          from: process.env.TWILIO_FROM_NUMBER,
          to: lead.telephone,
          body: corps,
        });
        await supabase.from("devis").update({ envoye_sms_at: new Date().toISOString() }).eq("id", devis_id);
        results.sms = { sent: true };
      }
    }
    return res.status(200).json({ results });
  } catch (err) {
    console.error("Erreur send-devis:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
