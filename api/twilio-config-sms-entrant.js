// Import ponctuel (25/11/2026) : récupère les réponses SMS des clients reçues
// avant le branchement du webhook (elles n'avaient été lues par personne).
// À supprimer après usage.
const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: options.prefer || "return=representation" } });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return t ? JSON.parse(t) : null;
}
export default async function handler(req, res) {
  const SID = process.env.TWILIO_ACCOUNT_SID, TOK = process.env.TWILIO_AUTH_TOKEN, FROM = process.env.TWILIO_FROM_NUMBER, MOI = (process.env.TWILIO_TO_NUMBER || "").replace(/\D/g, "").slice(-9);
  const auth = "Basic " + Buffer.from(`${SID}:${TOK}`).toString("base64");
  const depuis = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const d = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?To=${encodeURIComponent(FROM)}&DateSent>=${depuis}&PageSize=200`, { headers: { Authorization: auth } })).json();
  const out = [];
  for (const m of (d.messages || []).reverse()) {
    if (m.direction !== "inbound") continue;
    const fin = String(m.from).replace(/\D/g, "").slice(-9);
    if (fin === MOI) continue;
    const deja = await sb(`sms_entrants?twilio_sid=eq.${m.sid}&select=id`);
    const r = await sb(`leads?telephone=ilike.*${fin}&select=id,nom,prenom,reponses_sms&order=created_at.desc&limit=1`);
    const lead = r && r[0];
    out.push({ le: m.date_sent, qui: lead ? `${lead.prenom || ""} ${lead.nom || ""}`.trim() : "inconnu", message: (m.body || "").slice(0, 160), medias: +m.num_media || 0 });
    if (deja && deja.length) continue;
    await sb("sms_entrants", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ recu_at: new Date(m.date_sent).toISOString(), de: m.from, message: m.body, nb_medias: +m.num_media || 0, lead_id: lead ? lead.id : null, twilio_sid: m.sid }) });
    if (lead) {
      const hist = Array.isArray(lead.reponses_sms) ? lead.reponses_sms : [];
      hist.push({ le: new Date(m.date_sent).toISOString(), message: m.body || `(${m.num_media} photo(s) par MMS)` });
      await sb(`leads?id=eq.${lead.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ reponses_sms: hist.slice(-30), derniere_reponse_sms_at: new Date(m.date_sent).toISOString() }) });
    }
  }
  res.status(200).json({ ok: !d.code, err: d.message, nb: out.length, reponses: out });
}
