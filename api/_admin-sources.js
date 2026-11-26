// api/_admin-sources.js (25/11/2026)
// Tableau de bord unique : rassemble, en plus des leads SalesFlow, toutes les
// demandes qui arrivent par les autres applis (skyeco.fr, secrétaire
// téléphonique, Mon Assistant Pro, Contact Chantier, Avis Pro, Kit Pro,
// Skyeco Pro/Ads, Qui veut me lancer, artisans qui ont cliqué dans le mail
// vidéo). Chaque source est mise au même format :
//   { cle, famille: 'rms'|'skyeco', source, couleur, nom, sous_titre,
//     telephone, email, quand, objet, lignes: [[libellé, valeur]],
//     liens: [[libellé, url]], statut, note, archive }
// Le suivi (statut, note, archivage) de ces demandes est rangé dans la
// table admin_suivi (clé "table:id"), sans toucher aux tables d'origine.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MOI = /645688394/; // numéro de Cyrille : ses propres tests sont ignorés

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

const txt = (v) => {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(", ") || null;
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => (txt(x) ? `${k.replace(/_/g, " ")} : ${txt(x)}` : null)).filter(Boolean).join(" · ") || null;
  if (v === true) return "Oui";
  if (v === false) return "Non";
  return String(v).replace(/_/g, " ");
};
const lignesDe = (obj, exclus = []) =>
  Object.entries(obj || {})
    .filter(([k, v]) => !exclus.includes(k) && txt(v))
    .map(([k, v]) => [k.replace(/_/g, " "), txt(v)]);
const euros = (n) => (n == null ? null : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
const moi = (...vals) => vals.some((v) => v && MOI.test(String(v).replace(/\D/g, "")));

export async function autresDemandes() {
  const [
    spl, drafts, appels, rappels, demos, mapComptes, ccComptes, avis, kits, prixT, qvml, clics, suivi,
  ] = await Promise.all([
    sb("skyeco_pro_leads?select=*&archive=not.is.true&order=created_at.desc&limit=300"),
    sb("skyeco_pro_vitrine_drafts?select=id,entreprise,metier,telephone,email,zone,status,subscription_status,forfait_choisi,forfait,essai_gratuit_fin,est_demo,archive,created_at,contact_nom,contact_prenom&order=created_at.desc&limit=300"),
    sb("appels_ia?select=call_sid,appelant,fiche,historique,lead_id,created_at&lead_id=is.null&order=created_at.desc&limit=200"),
    sb("map_rappels?select=*&order=created_at.desc&limit=200"),
    sb("appels_demo?select=call_sid,appelant,fiche,created_at,numero_appele&order=created_at.desc&limit=200"),
    sb("map_comptes?select=siret,nom,email,etat,cree_le&order=cree_le.desc&limit=200"),
    sb("cc_comptes?select=id,nom,entreprise,tel,email,formule,essai_fin,abonne_jusqu_au,created_at&order=created_at.desc&limit=200"),
    sb("avis_pro_inscriptions?select=*&order=created_at.desc&limit=200"),
    sb("kit_pro_commandes?select=*&order=created_at.desc&limit=200"),
    sb("prix_travaux_commandes?select=*&order=created_at.desc&limit=200"),
    sb("qvml_inscriptions?select=*&order=created_at.desc&limit=200"),
    sb("map_envois?select=id,nom,email,categorie,clic_le,nb_clics,envoye_le,variante&clic_le=not.is.null&order=clic_le.desc&limit=200"),
    sb("admin_suivi?select=*"),
  ]);

  const draftParId = Object.fromEntries(drafts.map((d) => [d.id, d]));
  const out = [];
  const add = (it) => out.push(it);

  // ---------- CLIENTS RMS ----------
  for (const l of spl) {
    if (moi(l.telephone)) continue;
    const d = draftParId[l.draft_id] || {};
    const r = l.reponses || {};
    add({
      cle: `skyeco_pro_leads:${l.id}`, famille: "rms", source: d.est_demo ? "skyeco.fr (démo)" : "skyeco.fr", couleur: "#0d9488",
      nom: [l.prenom, l.nom].filter(Boolean).join(" ") || "Sans nom", telephone: l.telephone, email: l.email, quand: l.created_at,
      objet: txt(r.type_portail || r.produit || r.projet || r.type_projet) || txt(d.metier) || "Demande de devis",
      lignes: lignesDe(r, ["telephone", "email", "nom", "prenom"]),
      liens: [l.devis_pdf_url && [`Devis${l.devis_statut ? " (" + l.devis_statut + ")" : ""}${l.devis_signe_le ? " · signé" : ""}`, l.devis_pdf_url]].filter(Boolean),
      photos: Array.isArray(l.photos) ? l.photos.map((p) => (typeof p === "string" ? p : p && p.url)).filter(Boolean) : [],
      statutOrigine: l.statut,
    });
  }

  for (const a of appels) {
    const f = a.fiche || {};
    if (f.perso || f.demarcheur || moi(a.appelant)) continue;
    const parle = (a.historique || []).filter((m) => m.role === "user").map((m) => m.content).filter((c) => !String(c).startsWith("["));
    add({
      cle: `appels_ia:${a.call_sid}`, famille: f.skyeco ? "skyeco" : "rms", source: "Secrétaire téléphonique", couleur: "#7c3aed",
      nom: f.nom || "Appel sans nom", sous_titre: f.entreprise, telephone: f.telephone_rappel || a.appelant, quand: a.created_at,
      objet: [f.motif, f.type_projet].filter(Boolean).join(" · ") || (parle.length ? "Appel" : "Appel manqué sans message"),
      lignes: [["Commune", f.commune], ["Détails", f.details], ["Rappeler", f.quand_rappeler], ["Urgent", f.urgent ? "Oui" : null], ["Ce qu'il a dit", parle.join(" / ")]].filter(([, v]) => v),
      liens: [],
    });
  }

  // ---------- PROSPECTS SKYECO ----------
  for (const r of rappels) {
    if (moi(r.telephone)) continue;
    add({
      cle: `map_rappels:${r.id}`, famille: "skyeco", source: "Mon Assistant Pro", couleur: "#2563eb",
      nom: r.nom || "Sans nom", sous_titre: r.entreprise, telephone: r.telephone, quand: r.created_at,
      objet: "Demande de rappel" + (r.creneau ? ` · ${r.creneau}` : ""), lignes: [["Message", r.message], ["Source", r.source]].filter(([, v]) => v), liens: [],
    });
  }
  for (const a of demos) {
    if (moi(a.appelant)) continue;
    const f = a.fiche || {};
    add({
      cle: `appels_demo:${a.call_sid}`, famille: "skyeco", source: "Ligne démo (06 59 80 50 46)", couleur: "#2563eb",
      nom: [f.prenom, f.nom].filter(Boolean).join(" ") || "Appel démo", sous_titre: [f.entreprise, f.metier].filter(Boolean).join(" · "),
      telephone: f.telephone_sms || a.appelant, quand: a.created_at,
      objet: f.interesse === "oui" ? "Intéressé par Mon Assistant Pro" : "Appel à la ligne démo",
      lignes: [["Forfait conseillé", f.forfait_conseille], ["Appels / semaine", f.appels_semaine], ["Questions", f.questions], ["Suite", f.suite], ["Rappeler", f.quand_rappeler]].filter(([, v]) => v), liens: [],
    });
  }
  for (const c of mapComptes) {
    add({
      cle: `map_comptes:${c.siret}`, famille: "skyeco", source: "Mon Assistant Pro", couleur: "#2563eb",
      nom: c.nom || c.siret, email: c.email, quand: c.cree_le, objet: "Inscription à Mon Assistant Pro" + (c.etat ? ` (${c.etat})` : ""),
      lignes: [["SIRET", c.siret]], liens: [],
    });
  }
  for (const c of ccComptes) {
    if (moi(c.tel)) continue;
    add({
      cle: `cc_comptes:${c.id}`, famille: "skyeco", source: "Contact Chantier", couleur: "#ea580c",
      nom: c.nom || c.entreprise || c.email, sous_titre: c.entreprise, telephone: c.tel, email: c.email, quand: c.created_at,
      objet: "Compte Contact Chantier" + (c.formule ? ` · ${c.formule}` : ""),
      lignes: [["Fin d'essai", c.essai_fin && new Date(c.essai_fin).toLocaleDateString("fr-FR")], ["Abonné jusqu'au", c.abonne_jusqu_au && new Date(c.abonne_jusqu_au).toLocaleDateString("fr-FR")]].filter(([, v]) => v), liens: [],
    });
  }
  for (const a of avis) {
    add({
      cle: `avis_pro_inscriptions:${a.id}`, famille: "skyeco", source: "Avis Pro", couleur: "#ca8a04",
      nom: a.contact_nom || a.entreprise, sous_titre: a.entreprise, telephone: a.telephone, email: a.email, quand: a.created_at,
      objet: "Inscription Avis Pro" + (a.forfait ? ` · ${a.forfait}` : "") + (a.paye_le ? " · payé" : ""),
      lignes: [["Statut", a.statut], ["Fiche Google", a.fiche_google]].filter(([, v]) => v), liens: [],
    });
  }
  for (const k of kits) {
    add({
      cle: `kit_pro_commandes:${k.id}`, famille: "skyeco", source: "Kit Pro Artisan", couleur: "#9333ea",
      nom: k.nom || k.email, email: k.email, quand: k.created_at, objet: `Achat Kit Pro · ${euros((k.montant_centimes || 0) / 100)}`,
      lignes: [["Statut", k.statut], ["Livraison envoyée", k.email_livraison_envoye ? "Oui" : "Non"]], liens: [],
    });
  }
  for (const p of prixT) {
    add({
      cle: `prix_travaux_commandes:${p.id}`, famille: "skyeco", source: "Prix travaux", couleur: "#9333ea",
      nom: p.nom || p.email, email: p.email, quand: p.created_at, objet: `Commande ${p.metier || ""} · ${euros(p.montant_ttc) || ""}`,
      lignes: [["Département", p.departement], ["Statut", p.statut], ["Payé le", p.paye_le && new Date(p.paye_le).toLocaleDateString("fr-FR")]].filter(([, v]) => v), liens: [],
    });
  }
  const estRms = (d) => /rms|ecosky/i.test(d.entreprise || "");
  for (const d of drafts) {
    if (d.est_demo || d.archive || estRms(d) || moi(d.telephone)) continue;
    add({
      cle: `skyeco_pro_vitrine_drafts:${d.id}`, famille: "skyeco", source: "Skyeco Pro / Ads", couleur: "#16a34a",
      nom: [d.contact_prenom, d.contact_nom].filter(Boolean).join(" ") || d.entreprise || "Sans nom", sous_titre: d.entreprise,
      telephone: d.telephone, email: d.email, quand: d.created_at,
      objet: "Vitrine / pub" + (d.forfait_choisi || d.forfait ? ` · ${d.forfait_choisi || d.forfait}` : "") + (d.subscription_status ? ` · ${d.subscription_status}` : ""),
      lignes: [["Métier", txt(d.metier)], ["Zone", d.zone], ["Étape", d.status], ["Fin d'essai", d.essai_gratuit_fin && new Date(d.essai_gratuit_fin).toLocaleDateString("fr-FR")]].filter(([, v]) => v),
      liens: [["Ouvrir son espace", `https://www.skyeco.fr/mon-dashboard.html?id=${d.id}`]],
    });
  }
  for (const q of qvml) {
    if (moi(q.telephone)) continue;
    add({
      cle: `qvml_inscriptions:${q.id}`, famille: "skyeco", source: "Qui veut me lancer", couleur: "#db2777",
      nom: q.prenom || q.email, telephone: q.telephone, email: q.email, quand: q.created_at,
      objet: q.projet_titre || `Inscription (${q.type || "porteur de projet"})`,
      lignes: [["Ville", q.ville], ["Projet", q.projet_description], ["Besoins", txt(q.besoins)], ["Montant visé", euros(q.montant_vise)]].filter(([, v]) => v),
      liens: [q.video_url && ["Vidéo", q.video_url]].filter(Boolean),
    });
  }
  for (const m of clics) {
    add({
      cle: `map_envois:${m.id}`, famille: "skyeco", source: m.variante === "V" ? "Mail vidéo" : "Mail prospection", couleur: "#0891b2",
      nom: m.nom || m.email, email: m.email, quand: m.clic_le,
      objet: `A cliqué vers le site (${m.nb_clics || 1} clic${(m.nb_clics || 1) > 1 ? "s" : ""})`,
      lignes: [["Métier", m.categorie], ["Mail envoyé le", m.envoye_le && new Date(m.envoye_le).toLocaleDateString("fr-FR")]].filter(([, v]) => v), liens: [],
    });
  }

  // Suivi
  const s = Object.fromEntries(suivi.map((x) => [x.cle, x]));
  return out
    .map((it) => ({ ...it, statut: s[it.cle]?.statut || "nouveau", note: s[it.cle]?.note || "", archive: !!s[it.cle]?.archive, appels: s[it.cle]?.appels || [] }))
    .filter((it) => !it.archive)
    .sort((a, b) => new Date(b.quand || 0) - new Date(a.quand || 0));
}

export async function majSuivi(cle, patch) {
  const ligne = { cle, maj: new Date().toISOString() };
  for (const k of ["statut", "note", "archive", "appels"]) if (k in patch) ligne[k] = patch[k];
  const r = await fetch(`${SUPABASE_URL}/rest/v1/admin_suivi?on_conflict=cle`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([ligne]),
  });
  if (!r.ok) throw new Error(await r.text());
}
