// Correctif ponctuel (25/11/2026) : relit le prospect Meta de Didier Lamy avec
// le parseur corrigé et complète sa fiche (téléphone, notes). À supprimer.
import { mapFields, toE164 } from "./sync-meta-leads.js";
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
  const lead = await g(`1531583918803718?fields=field_data`, tok);
  if (!lead.field_data) return res.status(200).json({ ok: false, err: lead.error && lead.error.message });
  const f = mapFields(lead.field_data);
  const tel = toE164(f.telephone);
  const notes = ["Formulaire Meta : Portails Echo - Projet qualifié - Nov 2026", ...f.extras].join("\n");
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads?meta_lead_id=eq.1531583918803718`, {
    method: "PATCH",
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ telephone: tel, notes, adresse_projet: null }),
  });
  res.status(200).json({ ok: r.ok, telephone_trouve: !!tel, extras: f.extras.length });
}
