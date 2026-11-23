// api/l.js — lien court envoyé aux prospects Meta : /api/l?i=<lead_id>
// Note le clic (lien_clique_at) puis redirige vers le bon formulaire,
// pré-rempli avec le nom / téléphone / email du prospect.
// Avec &p=1 : redirige vers la page photos + adresse (photos.html).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = () => ({ apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" });

export default async function handler(req, res) {
  const id = String(req.query.i || "");
  const resine = "https://salesflow-ecosky.vercel.app/estimation.html?utm_source=facebook&utm_medium=lien_sms";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.redirect(302, resine);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&select=id,prenom,nom,telephone,email,type_projet,lien_clique_at`, { headers: H() });
    const lead = (await r.json())[0];
    if (!lead) return res.redirect(302, resine);
    if (!lead.lien_clique_at) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}`, { method: "PATCH", headers: H(), body: JSON.stringify({ lien_clique_at: new Date().toISOString() }) });
    }
    // Lien "photos" (&p=1) : page d'envoi de photos + adresse du chantier
    if (req.query.p === "1") {
      return res.redirect(302, `https://salesflow-ecosky.vercel.app/photos.html?lead_id=${id}`);
    }
    if (lead.type_projet === "portail") {
      const tel = String(lead.telephone || "").replace(/^\+33/, "0");
      const qs = new URLSearchParams({ utm_source: "facebook", utm_medium: "lien_sms", prenom: lead.prenom || "", nom: lead.nom || "", tel, email: lead.email || "" });
      return res.redirect(302, `https://www.skyeco.fr/devis-portails.html?${qs}`);
    }
    return res.redirect(302, `${resine}&lead_id=${id}`);
  } catch (e) {
    return res.redirect(302, resine);
  }
}
