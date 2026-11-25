// Diagnostic temporaire (lecture seule) : liste les formulaires Meta de la Page
// et le formulaire utilisé par la pub Portails. À supprimer après usage.
const GRAPH = "https://graph.facebook.com/v21.0";
const PAGE = process.env.META_PAGE_ID || "243043852219845";
async function g(path, tok) {
  const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(tok)}`);
  return r.json();
}
export default async function handler(req, res) {
  const sys = process.env.META_PAGE_TOKEN;
  let tok = sys;
  const p = await g(`${PAGE}?fields=access_token`, sys);
  if (p.access_token) tok = p.access_token;
  const forms = await g(`${PAGE}/leadgen_forms?fields=id,name,status,created_time,leads_count,questions{type,key,label}&limit=100`, tok);
  const out = { forms: (forms.data || []).map((f) => ({ id: f.id, name: f.name, status: f.status, created: f.created_time, leads: f.leads_count, questions: (f.questions || []).map((q) => q.type + (q.label ? ":" + q.label : "")) })), err: forms.error && forms.error.message };
  const lead = await g(`1531583918803718?fields=created_time,field_data,ad_id,ad_name,form_id`, tok);
  out.lead = lead.field_data ? { form_id: lead.form_id, ad: lead.ad_name, ad_id: lead.ad_id, champs: lead.field_data.map((f) => f.name + (f.values && f.values.length ? " = (rempli)" : " = (vide)")) } : lead;
  for (const ad of ["120251467643730718", "120251467644420718"]) {
    const a = await g(`${ad}?fields=name,effective_status,creative{object_story_spec,asset_feed_spec}`, sys);
    const s = JSON.stringify(a);
    out[ad] = { name: a.name, status: a.effective_status, lead_gen_form_ids: [...new Set((s.match(/"lead_gen_form_id":"?(\d+)/g) || []).map((x) => x.replace(/\D/g, "")))], err: a.error && a.error.message };
  }
  res.status(200).json(out);
}
