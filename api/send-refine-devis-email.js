// api/send-refine-devis-email.js
// Envoie un email automatique à un lead capté via le formulaire instantané
// Meta, avec un bouton "Réaliser mon devis" qui renvoie vers le site avec
// un lien personnalisé (contenant son lead_id) — le site pourra alors le
// reconnaître automatiquement et pré-remplir ses coordonnées, sans qu'il
// ait à retaper quoi que ce soit.
//
// Appelé par Make.com juste après l'insertion du lead dans Supabase
// (scénario "Integration Facebook Lead Ads").

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id, prenom, nom, email } = req.body || {};

    if (!lead_id || !email) {
      return res.status(200).json({ sent: false, reason: "lead_id ou email manquant" });
    }

    const refineLink = `https://salesflow-ecosky.vercel.app/estimation.html?lead_id=${encodeURIComponent(lead_id)}`;
    const firstName = prenom || "";

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #14312a;">
        <h2 style="color: #1e6f4c;">Merci pour votre demande${firstName ? `, ${firstName}` : ""} !</h2>
        <p>Vous avez fait une demande de renseignements suite à notre publicité sur la résine EPDM EcoSky'Gum.</p>
        <p>Voulez-vous aller plus loin ? Affinez votre projet grâce à notre outil d'estimation : indiquez la surface, l'état du support et vos préférences pour recevoir un chiffrage détaillé et personnalisé.</p>
        <p style="text-align:center; margin: 28px 0;">
          <a href="${refineLink}" style="background:#1e6f4c; color:white; padding:14px 28px; border-radius:10px; text-decoration:none; font-weight:bold;">
            Affiner mon devis
          </a>
        </p>
        <p style="font-size:13px; color:#5b6b64;">Sans engagement — réponse sous 24h.</p>
        <hr style="border:none; border-top:1px solid #e2e0d5; margin:24px 0;" />
        <p style="font-size:11px; color:#8a9490;">
          RMS EcoSky — RESINE MARBRE SOL, 23 Route de Corn Er Hoet, 56400 Brech<br/>
          <a href="https://www.ecoskybyrms.fr" style="color:#1e6f4c;">www.ecoskybyrms.fr</a>
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: email,
        subject: "Affinez votre devis résine EPDM gratuit",
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Erreur Resend (send-refine-devis-email):", resendRes.status, errText);
      return res.status(200).json({ sent: false, error: errText });
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error("send-refine-devis-email error:", err.message);
    return res.status(200).json({ sent: false, error: err.message });
  }
}
