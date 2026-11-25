// Appli mobile SalesFlow (/mobile) — "Mes demandes"
// Liste toutes les demandes de devis (Meta, Google, site, téléphone, manuel),
// avec bouton Appeler direct, et une fiche détaillée : la demande du client,
// l'estimation PDF, les devis, les photos. Données lues via
// /api/dashboard-data?view=demandes (protégé par le mot de passe du dashboard),
// modifications via /api/leads-admin.
import React, { useState, useEffect, useMemo } from "react";

const VERT = "#2e7d32";
const VERT_FONCE = "#1b5e20";
const FOND = "#f4f7f4";

// ---------- utilitaires ----------
function telBrut(p) {
  if (!p) return "";
  let t = String(p).replace(/[^\d+]/g, "");
  if (t.startsWith("0033")) t = "+33" + t.slice(4);
  if (/^0\d{9}$/.test(t)) t = "+33" + t.slice(1);
  if (/^33\d{9}$/.test(t)) t = "+" + t;
  return t;
}
function telAffiche(p) {
  const t = telBrut(p);
  if (/^\+33\d{9}$/.test(t)) return ("0" + t.slice(3)).replace(/(\d{2})(?=\d)/g, "$1 ");
  return p || "";
}
function telValide(p) {
  const t = telBrut(p);
  return t.length >= 10;
}
function ilYa(d) {
  if (!d) return "";
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j === 1 ? "hier" : `il y a ${j} j`;
}
function dateFr(d, avecHeure = true) {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short", day: "numeric", month: "short",
      ...(avecHeure ? { hour: "2-digit", minute: "2-digit" } : {}),
      timeZone: "Europe/Paris",
    }).format(new Date(d));
  } catch (e) { return d; }
}
function euros(n) {
  if (n == null || n === "") return "";
  return Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
function nomComplet(l) {
  const n = [l.prenom, l.nom].filter(Boolean).join(" ").trim();
  return n || "Sans nom";
}
// Le client a répondu par SMS depuis notre dernière action sur sa fiche
function aReponduSms(l) {
  if (!l.derniere_reponse_sms_at) return false;
  return !l.reponse_sms_vue_at || new Date(l.derniere_reponse_sms_at) > new Date(l.reponse_sms_vue_at);
}
function estATraiter(l) {
  return l.callback_demande || aReponduSms(l) || !l.statut || l.statut === "nouveau";
}
function couleurSource(l) {
  const c = (l.canal || l.source || "").toLowerCase();
  if (c.includes("meta") || c.includes("facebook")) return ["Meta", "#1877f2"];
  if (c.includes("google")) return ["Google", "#ea4335"];
  if (c.includes("site") || c.includes("formulaire estimation")) return ["Site", "#0d9488"];
  if (c.includes("téléphone") || c.includes("telephone")) return ["Téléphone", "#7c3aed"];
  if (c.includes("manuel")) return ["Manuel", "#64748b"];
  return [l.canal || l.source || "Autre", "#64748b"];
}
function listePhotos(l) {
  const out = [];
  for (const champ of [l.photos_chantier_urls, l.photos_projet]) {
    if (Array.isArray(champ)) champ.forEach((u) => typeof u === "string" ? out.push(u) : u?.url && out.push(u.url));
  }
  return out;
}

const LIBELLES = {
  usage: "Usage", surface: "Surface (m²)", support_pieton: "Support", etat_dalle: "État de la dalle",
  enlevement_carrelage: "Enlèvement carrelage", etat_terrain_carrossable: "Terrain",
  coloris: "Coloris", couleur_granulat: "Couleur granulat", bordure: "Bordure",
  bordure_metres: "Bordure (ml)", age_batiment: "Âge du bâtiment", delai: "Délai",
  ville: "Ville", code_postal: "Code postal",
};
function valeurLisible(v) {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v.map(valeurLisible).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.values(v).map(valeurLisible).filter(Boolean).join(", ");
  if (v === true) return "Oui";
  if (v === false) return "Non";
  return String(v).replace(/_/g, " ");
}

// ---------- appli ----------
export default function MobileSummary() {
  const [leads, setLeads] = useState([]);
  const [devis, setDevis] = useState([]);
  const [autres, setAutres] = useState([]);
  const [famille, setFamille] = useState(() => { try { return localStorage.getItem("sf_famille") || "rms"; } catch (e) { return "rms"; } });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState("traiter");
  const [recherche, setRecherche] = useState("");
  const [ouvertId, setOuvertId] = useState(null);
  const [annulable, setAnnulable] = useState(null); // dernier archivage, pour « Annuler »

  const charger = async () => {
    setChargement(true);
    try {
      const r = await fetch("/api/dashboard-data?view=demandes", { credentials: "same-origin", cache: "no-store" });
      if (r.status === 401 || r.redirected) { window.location.href = "/connexion?next=/mobile"; return; }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setLeads(d.leads || []);
      setDevis(d.devis || []);
      setAutres(d.autres || []);
      setErreur("");
    } catch (e) {
      setErreur("Impossible de charger les demandes. Vérifie ta connexion puis appuie sur ↻.");
    }
    setChargement(false);
  };

  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000);
    return () => clearInterval(t);
  }, []);

  const devisParLead = useMemo(() => {
    const m = {};
    devis.forEach((d) => { if (d.lead_id) (m[d.lead_id] = m[d.lead_id] || []).push(d); });
    return m;
  }, [devis]);

  // Tableau de bord unique (25/11/2026) : leads SalesFlow + toutes les autres applis
  const elements = useMemo(() => {
    const l1 = famille === "rms" ? leads.filter((l) => !l.archive).map((l) => ({ type: "lead", id: l.id, quand: l.created_at, aTraiter: estATraiter(l), l })) : [];
    const l2 = autres.filter((a) => a.famille === famille).map((a) => ({ type: "autre", id: a.cle, quand: a.quand, aTraiter: autreATraiter(a), a }));
    return [...l1, ...l2].sort((x, y) => new Date(y.quand || 0) - new Date(x.quand || 0));
  }, [leads, autres, famille]);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return elements.filter((e) => {
      if (onglet === "traiter" && !e.aTraiter) return false;
      if (!q) return true;
      const champs = e.type === "lead"
        ? [e.l.nom, e.l.prenom, e.l.telephone, e.l.email, e.l.adresse_projet, e.l.adresse, e.l.code_postal, e.l.type_projet]
        : [e.a.nom, e.a.sous_titre, e.a.telephone, e.a.email, e.a.objet, e.a.source];
      const tel = e.type === "lead" ? e.l.telephone : e.a.telephone;
      return champs.filter(Boolean).join(" ").toLowerCase().includes(q) || (q.replace(/\s/g, "").length > 3 && telBrut(tel).includes(q.replace(/\s/g, "")));
    });
  }, [elements, onglet, recherche]);

  const nbATraiter = elements.filter((e) => e.aTraiter).length;
  const compte = (f) => (f === "rms" ? leads.filter(estATraiter).length : 0) + autres.filter((a) => a.famille === f && autreATraiter(a)).length;
  const choisirFamille = (f) => { setFamille(f); try { localStorage.setItem("sf_famille", f); } catch (e) {} };
  const ouvert = leads.find((l) => l.id === ouvertId);
  const ouvertAutre = autres.find((a) => a.cle === ouvertId);

  const modifierAutre = async (cle, patch) => {
    setAutres((as) => as.map((a) => (a.cle === cle ? { ...a, ...patch } : a)).filter((a) => !a.archive));
    try {
      const r = await fetch("/api/leads-admin", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_suivi", cle, patch }),
      });
      if (!r.ok) throw new Error();
    } catch (e) {
      alert("La modification n'a pas été enregistrée. Réessaie.");
      charger();
    }
  };

  const modifier = async (id, patch) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    try {
      const r = await fetch("/api/leads-admin", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_lead", id, patch }),
      });
      if (!r.ok) throw new Error();
    } catch (e) {
      alert("La modification n'a pas été enregistrée. Réessaie.");
      charger();
    }
  };

  // Archivage en un clic depuis la liste, avec « Annuler » pendant 6 s
  const archiverDepuisListe = (e) => {
    if (e.type === "lead") modifier(e.id, { archive: true });
    else modifierAutre(e.id, { archive: true });
    const nom = e.type === "lead" ? nomComplet(e.l) : e.a.nom;
    setAnnulable({ e, nom });
    clearTimeout(window.__sfAnnul);
    window.__sfAnnul = setTimeout(() => setAnnulable(null), 6000);
  };
  const annulerArchive = () => {
    if (!annulable) return;
    const { e } = annulable;
    if (e.type === "lead") modifier(e.id, { archive: false });
    else { setAutres((as) => [...as, { ...e.a, archive: false }]); modifierAutre(e.id, { archive: false }); }
    setAnnulable(null);
  };

  if (ouvertAutre) {
    return <FicheAutre a={ouvertAutre} retour={() => setOuvertId(null)} modifier={modifierAutre} />;
  }
  if (ouvert) {
    return <Fiche lead={ouvert} devis={devisParLead[ouvert.id] || []} retour={() => setOuvertId(null)} modifier={modifier} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: FOND, fontFamily: "-apple-system, system-ui, Segoe UI, Roboto, sans-serif", paddingBottom: 40 }}>
      <div style={{ background: VERT, color: "#fff", padding: "max(14px, env(safe-area-inset-top)) 16px 12px", position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, fontSize: 19 }}>Tableau de bord</div>
          <button onClick={charger} aria-label="Actualiser" style={{ background: "rgba(255,255,255,.15)", border: 0, color: "#fff", fontSize: 20, width: 40, height: 40, borderRadius: 20 }}>
            <span style={{ display: "inline-block", animation: chargement ? "tourne 1s linear infinite" : "none" }}>↻</span>
          </button>
        </div>
        <input
          value={recherche} onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un nom, un numéro, une ville…"
          style={{ width: "100%", boxSizing: "border-box", marginTop: 10, padding: "10px 12px", fontSize: 16, border: 0, borderRadius: 10 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Onglet actif={famille === "rms"} onClick={() => choisirFamille("rms")}>🏠 RMS ({compte("rms")})</Onglet>
          <Onglet actif={famille === "skyeco"} onClick={() => choisirFamille("skyeco")}>🚀 Skyeco ({compte("skyeco")})</Onglet>
          <Onglet actif={famille === "applis"} onClick={() => choisirFamille("applis")}>🧰 Applis</Onglet>
        </div>
        {famille !== "applis" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Onglet actif={onglet === "traiter"} onClick={() => setOnglet("traiter")}>À traiter ({nbATraiter})</Onglet>
          <Onglet actif={onglet === "toutes"} onClick={() => setOnglet("toutes")}>Toutes ({elements.length})</Onglet>
        </div>}
      </div>
      <style>{`@keyframes tourne { to { transform: rotate(360deg); } }`}</style>

      {erreur && <div style={{ margin: 16, padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 10, fontSize: 14 }}>{erreur}</div>}

      {famille === "applis" ? <MesApplis /> : <div style={{ padding: "12px 12px 0" }}>
        {!chargement && filtres.length === 0 && !erreur && (
          <div style={{ textAlign: "center", color: "#64748b", padding: 30, fontSize: 15 }}>
            {onglet === "traiter" ? "Rien à traiter 👍" : "Aucune demande trouvée"}
          </div>
        )}
        {filtres.map((e) => e.type === "lead" ? (
          <Carte key={e.id} lead={e.l} nbDevis={(devisParLead[e.id] || []).length} ouvrir={() => { setOuvertId(e.id); window.scrollTo(0, 0); }} archiver={() => archiverDepuisListe(e)} />
        ) : (
          <CarteAutre key={e.id} a={e.a} ouvrir={() => { setOuvertId(e.id); window.scrollTo(0, 0); }} archiver={() => archiverDepuisListe(e)} />
        ))}
      </div>}
      <div style={{ textAlign: "center", marginTop: 20 }}>
        <a href="/deconnexion" style={{ color: "#94a3b8", fontSize: 13 }}>Se déconnecter</a>
      </div>
      {annulable && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: "max(16px, env(safe-area-inset-bottom))", background: "#0f172a", color: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, zIndex: 50, boxShadow: "0 4px 16px rgba(0,0,0,.25)", fontSize: 14 }}>
          <span>🗄️ {annulable.nom} archivé</span>
          <button onClick={annulerArchive} style={{ background: "none", border: 0, color: "#86efac", fontWeight: 700, fontSize: 15 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}

function Onglet({ actif, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "8px 0", fontSize: 14, fontWeight: 600, borderRadius: 8, border: 0,
      background: actif ? "#fff" : "rgba(255,255,255,.15)", color: actif ? VERT_FONCE : "#fff",
    }}>{children}</button>
  );
}

function Carte({ lead: l, nbDevis, ouvrir, archiver }) {
  const [src, coul] = couleurSource(l);
  const details = [l.type_projet, l.surface_m2 ? `${l.surface_m2} m²` : null, l.code_postal].filter(Boolean).join(" · ");
  return (
    <div style={{ background: "#fff", borderRadius: 14, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,.06)", borderLeft: `4px solid ${l.callback_demande ? "#dc2626" : estATraiter(l) ? VERT : "#cbd5e1"}`, overflow: "hidden" }}>
      <div onClick={ouvrir} style={{ padding: "12px 14px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{nomComplet(l)}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{ilYa(l.created_at)}</div>
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 1 }}>📅 Demande du {dateFr(l.created_at)}</div>
        <div style={{ fontSize: 14, color: "#334155", marginTop: 2 }}>{telAffiche(l.telephone) || <i style={{ color: "#94a3b8" }}>pas de téléphone</i>}</div>
        {details && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{details}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Badge c={coul}>{src}</Badge>
          {aReponduSms(l) && <Badge c="#2563eb">💬 a répondu</Badge>}
          {l.callback_demande && <Badge c="#dc2626">📞 Veut être rappelé</Badge>}
          {l.rdv_date && <Badge c="#7c3aed">📅 {dateFr(l.rdv_date)}</Badge>}
          {l.estimation_pdf_url && <Badge c="#0d9488">Estimation</Badge>}
          {nbDevis > 0 && <Badge c="#b45309">{nbDevis} devis</Badge>}
          {l.statut && l.statut !== "nouveau" && <Badge c="#64748b">{l.statut}</Badge>}
        </div>
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #f1f5f9" }}>
        {telValide(l.telephone) ? (
          <a href={`tel:${telBrut(l.telephone)}`} style={{ ...btnBas, color: "#fff", background: VERT }}>📞 Appeler</a>
        ) : (
          <span style={{ ...btnBas, color: "#94a3b8" }}>📞 —</span>
        )}
        <button onClick={ouvrir} style={{ ...btnBas, background: "#fff", color: VERT_FONCE, border: 0 }}>Voir la demande ›</button>
        <button onClick={archiver} style={{ ...btnBas, flex: "0 0 auto", padding: "0 14px", background: "#fff", color: "#64748b", border: 0, borderLeft: "1px solid #f1f5f9" }}>🗄️ Archiver</button>
      </div>
    </div>
  );
}

function Badge({ c, children }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: c, background: c + "18", padding: "3px 8px", borderRadius: 20 }}>{children}</span>;
}

// Bouton « Demander photos + adresse » : envoie le SMS automatique
// (api/request-photos.js) avec le lien vers photos.html pour ce client.
function DemandePhotos({ lead: l }) {
  const [etat, setEtat] = useState(l.demande_photos_envoyee ? "deja" : "repos");
  const envoyer = async () => {
    setEtat("envoi");
    try {
      const r = await fetch("/api/request-photos", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(l.id && !l.cle ? { lead_id: l.id } : { telephone: l.telephone, nom: l.nom }),
      });
      const j = await r.json().catch(() => ({}));
      setEtat(j.success ? "ok" : "erreur");
    } catch (e) { setEtat("erreur"); }
  };
  const base = { ...btnAction, width: "100%", marginTop: 8, boxSizing: "border-box" };
  if (etat === "ok") return <div style={{ ...base, background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0" }}>✅ SMS envoyé : lien photos + adresse et catalogues</div>;
  if (etat === "confirmer") return (
    <div style={{ marginTop: 8, padding: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, fontSize: 14 }}>
      Envoyer à {nomComplet(l)} ({telAffiche(l.telephone)}) un SMS avec le lien pour envoyer ses photos et son adresse exacte, et nos catalogues ?
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <button onClick={envoyer} style={{ ...btnAction, background: VERT, color: "#fff" }}>Oui, envoyer</button>
        <button onClick={() => setEtat(l.demande_photos_envoyee ? "deja" : "repos")} style={btnAction}>Annuler</button>
      </div>
    </div>
  );
  return (
    <button disabled={etat === "envoi"} onClick={() => setEtat("confirmer")} style={{ ...base, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" }}>
      {etat === "envoi" ? "Envoi en cours…" : etat === "erreur" ? "⚠️ Échec — réessayer le SMS photos + adresse + catalogue" : etat === "deja" ? "📷 Renvoyer le SMS photos + adresse + catalogue" : "📷 SMS photos + adresse + catalogue"}
    </button>
  );
}

function Fiche({ lead: l, devis, retour, modifier }) {
  const tel = telBrut(l.telephone);
  const adresse = [l.adresse_projet || l.adresse, l.code_postal].filter(Boolean).join(" ");
  const reponses = l.reponses_estimation && typeof l.reponses_estimation === "object" ? l.reponses_estimation : null;
  const photos = listePhotos(l);
  const [src, coul] = couleurSource(l);

  useEffect(() => {
    const onBack = () => retour();
    window.history.pushState({ fiche: true }, "");
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  const lignesDemande = [
    ["Projet", l.type_projet],
    ["Surface", l.surface_m2 ? `${l.surface_m2} m²` : null],
    ["Support existant", l.support_existant],
    ["Couleur", l.couleur_souhaitee],
    ["Délai", l.delai_souhaite],
    ["Formulaire", l.meta_form_name],
    ["Campagne", l.utm_campaign],
  ].filter(([, v]) => v);

  return (
    <div style={{ minHeight: "100vh", background: FOND, fontFamily: "-apple-system, system-ui, Segoe UI, Roboto, sans-serif", paddingBottom: 40 }}>
      <div style={{ background: VERT, color: "#fff", padding: "max(12px, env(safe-area-inset-top)) 12px 14px", position: "sticky", top: 0, zIndex: 5 }}>
        <button onClick={() => window.history.back()} style={{ background: "none", border: 0, color: "#fff", fontSize: 16, padding: "4px 0" }}>‹ Retour</button>
        <div style={{ fontWeight: 700, fontSize: 21, marginTop: 4 }}>{nomComplet(l)}</div>
        <div style={{ fontSize: 13, opacity: .85 }}>Demande reçue {dateFr(l.created_at)} · {src}</div>
      </div>

      <div style={{ padding: 12 }}>
        {/* Actions de contact */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {tel.length >= 10 && <a href={`tel:${tel}`} style={{ ...btnAction, background: VERT, color: "#fff", gridColumn: "1 / -1", fontSize: 18 }}>📞 Appeler {telAffiche(l.telephone)}</a>}
          {tel.length >= 10 && <a href={`sms:${tel}`} style={btnAction}>💬 SMS</a>}
          {l.email && <a href={`mailto:${l.email}`} style={btnAction}>✉️ Email</a>}
          {adresse && <a href={`https://maps.apple.com/?q=${encodeURIComponent(adresse)}`} style={btnAction}>📍 Itinéraire</a>}
        </div>
        {tel.length >= 10 && <DemandePhotos lead={l} />}
        {l.callback_demande && (
          <div style={{ marginTop: 10, padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 10, fontSize: 14 }}>
            📞 A demandé à être rappelé {ilYa(l.callback_demande_le)}
          </div>
        )}
        {l.rdv_date && (
          <div style={{ marginTop: 10, padding: 10, background: "#f5f3ff", color: "#5b21b6", borderRadius: 10, fontSize: 14 }}>
            📅 Rendez-vous : {dateFr(l.rdv_date)}
          </div>
        )}

        {Array.isArray(l.reponses_sms) && l.reponses_sms.length > 0 && (
          <Bloc titre="💬 Ses réponses par SMS">
            {[...l.reponses_sms].reverse().map((r, k) => (
              <div key={k} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{dateFr(r.le)}</div>
                <div style={{ fontSize: 15, color: "#0f172a", whiteSpace: "pre-wrap" }}>{r.message}</div>
              </div>
            ))}
            {aReponduSms(l) && (
              <button onClick={() => modifier(l.id, { reponse_sms_vue_at: new Date().toISOString() })} style={{ ...btnAction, width: "100%", marginTop: 8, boxSizing: "border-box" }}>✓ Marquer comme lu</button>
            )}
          </Bloc>
        )}

        <Bloc titre="Coordonnées">
          <Ligne k="Téléphone" v={telAffiche(l.telephone)} />
          <Ligne k="Email" v={l.email} />
          <Ligne k="Adresse chantier" v={adresse} />
        </Bloc>

        <Bloc titre="Sa demande">
          {lignesDemande.map(([k, v]) => <Ligne key={k} k={k} v={v} />)}
          {reponses && Object.entries(reponses).map(([k, v]) => {
            const val = valeurLisible(v);
            if (!val || ["code_postal", "surface"].includes(k)) return null;
            return <Ligne key={k} k={LIBELLES[k] || k.replace(/_/g, " ")} v={val} />;
          })}
          {l.estimation_texte && (
            <div style={{ marginTop: 8, padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 14, whiteSpace: "pre-wrap", color: "#334155" }}>{l.estimation_texte}</div>
          )}
          {l.notes && (
            <div style={{ marginTop: 8, padding: 10, background: "#fffbeb", borderRadius: 8, fontSize: 14, whiteSpace: "pre-wrap", color: "#78350f" }}>📝 {l.notes}</div>
          )}
          {!lignesDemande.length && !reponses && !l.estimation_texte && !l.notes && (
            <div style={{ color: "#94a3b8", fontSize: 14 }}>Pas de détail : le client n'a pas encore rempli le formulaire d'estimation.</div>
          )}
        </Bloc>

        <Bloc titre="Estimation et devis">
          {l.estimation_pdf_url && (
            <a href={l.estimation_pdf_url} target="_blank" rel="noreferrer" style={lienDoc}>
              📄 Estimation {l.estimation_numero || ""} <span style={{ color: "#94a3b8" }}>›</span>
            </a>
          )}
          {devis.map((d) => (
            <div key={d.id}>
              <a href={d.pdf_signe_url || d.pdf_url} target="_blank" rel="noreferrer" style={lienDoc}>
                <span>
                  📑 {d.type_document === "facture" ? "Facture" : "Devis"} {d.numero || ""}
                  {d.montant_ttc != null && <b> · {euros(d.montant_ttc)}</b>}
                  <div style={{ fontSize: 12, color: d.date_signature ? VERT : "#64748b", fontWeight: 500 }}>
                    {d.date_signature ? `✅ Signé ${dateFr(d.date_signature, false)}` :
                      d.envoye_email_at || d.envoye_sms_at ? `Envoyé ${dateFr(d.envoye_email_at || d.envoye_sms_at, false)}` :
                      `Créé ${dateFr(d.created_at, false)} · pas encore envoyé`}
                  </div>
                </span>
                <span style={{ color: "#94a3b8" }}>›</span>
              </a>
            </div>
          ))}
          {!l.estimation_pdf_url && devis.length === 0 && <div style={{ color: "#94a3b8", fontSize: 14 }}>Aucun document pour l'instant.</div>}
          <a href={`/sms-recus.html#lead-${l.id}`} style={{ display: "block", marginTop: 10, fontSize: 14, color: VERT_FONCE }}>+ Faire / envoyer un devis (tableau de bord)</a>
        </Bloc>

        {photos.length > 0 && (
          <Bloc titre={`Photos (${photos.length})`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
                </a>
              ))}
            </div>
          </Bloc>
        )}

        <Bloc titre="Suivi">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["nouveau", "contacté", "devis envoyé", "gagné", "perdu"].map((s) => (
              <button key={s} onClick={() => modifier(l.id, { statut: s, ...(s !== "nouveau" ? { callback_demande: false } : {}) })}
                style={{ padding: "8px 12px", fontSize: 14, borderRadius: 20, border: `1px solid ${l.statut === s ? VERT : "#cbd5e1"}`, background: l.statut === s ? VERT : "#fff", color: l.statut === s ? "#fff" : "#334155", fontWeight: 600 }}>
                {s}
              </button>
            ))}
          </div>
          <button onClick={() => { if (confirm("Archiver cette demande ? Elle disparaîtra de la liste.")) { modifier(l.id, { archive: true }); window.history.back(); } }}
            style={{ marginTop: 14, width: "100%", padding: 12, fontSize: 15, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b" }}>
            Archiver la demande
          </button>
        </Bloc>
      </div>
    </div>
  );
}

function Bloc({ titre, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginTop: 12, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: .4, marginBottom: 8 }}>{titre}</div>
      {children}
    </div>
  );
}
function Ligne({ k, v }) {
  if (!v) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 15 }}>
      <span style={{ color: "#64748b" }}>{k}</span>
      <span style={{ color: "#0f172a", textAlign: "right", fontWeight: 500, wordBreak: "break-word" }}>{v}</span>
    </div>
  );
}

const btnBas = { flex: 1, textAlign: "center", padding: "12px 0", fontSize: 15, fontWeight: 700, textDecoration: "none", cursor: "pointer" };
const btnAction = { display: "block", textAlign: "center", padding: "14px 8px", borderRadius: 12, background: "#fff", color: VERT_FONCE, fontWeight: 700, fontSize: 15, textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,.08)" };
const lienDoc = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9", color: "#0f172a", textDecoration: "none", fontSize: 15, fontWeight: 600 };


// ---------- demandes des autres applis (25/11/2026) ----------
function autreATraiter(a) {
  return !a.statut || a.statut === "nouveau" || a.statut === "à rappeler";
}

function CarteAutre({ a, ouvrir, archiver }) {
  const c = a.couleur || "#64748b";
  return (
    <div style={{ background: "#fff", borderRadius: 14, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,.06)", borderLeft: `4px solid ${a.statut === "à rappeler" ? "#dc2626" : autreATraiter(a) ? VERT : "#cbd5e1"}`, overflow: "hidden" }}>
      <div onClick={ouvrir} style={{ padding: "12px 14px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{a.nom}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{ilYa(a.quand)}</div>
        </div>
        {a.quand && <div style={{ fontSize: 13, color: "#475569", marginTop: 1 }}>📅 Demande du {dateFr(a.quand)}</div>}
        {a.sous_titre && <div style={{ fontSize: 13, color: "#475569" }}>{a.sous_titre}</div>}
        <div style={{ fontSize: 14, color: "#334155", marginTop: 2 }}>{telAffiche(a.telephone) || a.email || <i style={{ color: "#94a3b8" }}>pas de coordonnées</i>}</div>
        {a.objet && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{a.objet}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Badge c={c}>{a.source}</Badge>
          {a.liens && a.liens.length > 0 && <Badge c="#b45309">{a.liens.length} document{a.liens.length > 1 ? "s" : ""}</Badge>}
          {a.statut && a.statut !== "nouveau" && <Badge c={a.statut === "à rappeler" ? "#dc2626" : "#64748b"}>{a.statut}</Badge>}
        </div>
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #f1f5f9" }}>
        {telValide(a.telephone) ? (
          <a href={`tel:${telBrut(a.telephone)}`} style={{ ...btnBas, color: "#fff", background: VERT }}>📞 Appeler</a>
        ) : a.email ? (
          <a href={`mailto:${a.email}`} style={{ ...btnBas, color: "#fff", background: "#2563eb" }}>✉️ Écrire</a>
        ) : (
          <span style={{ ...btnBas, color: "#94a3b8" }}>📞 —</span>
        )}
        <button onClick={ouvrir} style={{ ...btnBas, background: "#fff", color: VERT_FONCE, border: 0 }}>Voir ›</button>
        <button onClick={archiver} style={{ ...btnBas, flex: "0 0 auto", padding: "0 14px", background: "#fff", color: "#64748b", border: 0, borderLeft: "1px solid #f1f5f9" }}>🗄️ Archiver</button>
      </div>
    </div>
  );
}

function FicheAutre({ a, retour, modifier }) {
  const tel = telBrut(a.telephone);
  const [note, setNote] = useState(a.note || "");
  useEffect(() => {
    const onBack = () => retour();
    window.history.pushState({ fiche: true }, "");
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  return (
    <div style={{ minHeight: "100vh", background: FOND, fontFamily: "-apple-system, system-ui, Segoe UI, Roboto, sans-serif", paddingBottom: 40 }}>
      <div style={{ background: VERT, color: "#fff", padding: "max(12px, env(safe-area-inset-top)) 12px 14px", position: "sticky", top: 0, zIndex: 5 }}>
        <button onClick={() => window.history.back()} style={{ background: "none", border: 0, color: "#fff", fontSize: 16, padding: "4px 0" }}>‹ Retour</button>
        <div style={{ fontWeight: 700, fontSize: 21, marginTop: 4 }}>{a.nom}</div>
        <div style={{ fontSize: 13, opacity: .85 }}>Reçu {dateFr(a.quand)} · {a.source}</div>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {tel.length >= 10 && <a href={`tel:${tel}`} style={{ ...btnAction, background: VERT, color: "#fff", gridColumn: "1 / -1", fontSize: 18 }}>📞 Appeler {telAffiche(a.telephone)}</a>}
          {tel.length >= 10 && <a href={`sms:${tel}`} style={btnAction}>💬 SMS</a>}
          {a.email && <a href={`mailto:${a.email}`} style={btnAction}>✉️ Email</a>}
        </div>
        {tel.length >= 10 && a.famille === "rms" && <DemandePhotos lead={a} />}
        <Bloc titre="Coordonnées">
          <Ligne k="Entreprise" v={a.sous_titre} />
          <Ligne k="Téléphone" v={telAffiche(a.telephone)} />
          <Ligne k="Email" v={a.email} />
        </Bloc>
        <Bloc titre="La demande">
          <Ligne k="Objet" v={a.objet} />
          {(a.lignes || []).map(([k, v]) => <Ligne key={k} k={k} v={v} />)}
        </Bloc>
        {(a.liens || []).length > 0 && (
          <Bloc titre="Documents et liens">
            {a.liens.map(([lib, url]) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" style={lienDoc}>📑 {lib} <span style={{ color: "#94a3b8" }}>›</span></a>
            ))}
          </Bloc>
        )}
        {(a.photos || []).length > 0 && (
          <Bloc titre={`Photos (${a.photos.length})`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {a.photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} /></a>
              ))}
            </div>
          </Bloc>
        )}
        <Bloc titre="Suivi">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["nouveau", "à rappeler", "rappelé", "devis envoyé", "gagné", "perdu"].map((st) => (
              <button key={st} onClick={() => modifier(a.cle, { statut: st })}
                style={{ padding: "8px 12px", fontSize: 14, borderRadius: 20, border: `1px solid ${a.statut === st ? VERT : "#cbd5e1"}`, background: a.statut === st ? VERT : "#fff", color: a.statut === st ? "#fff" : "#334155", fontWeight: 600 }}>
                {st}
              </button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (a.note || "") && modifier(a.cle, { note })}
            placeholder="Note (ex. rappeler jeudi, intéressé par…)" rows={3}
            style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: 10, fontSize: 15, borderRadius: 10, border: "1px solid #e2e8f0" }} />
          <button onClick={() => { if (confirm("Archiver cette demande ? Elle disparaîtra de la liste.")) { modifier(a.cle, { archive: true }); window.history.back(); } }}
            style={{ marginTop: 14, width: "100%", padding: 12, fontSize: 15, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b" }}>
            Archiver la demande
          </button>
        </Bloc>
      </div>
    </div>
  );
}


// ---------- Mes applis : accès direct à toutes les applis (25/11/2026) ----------
const RMS_DRAFT = "89338dcc-a009-4815-a769-f0bede180f37";
const APPLIS = [
  ["RMS EcoSky — mes outils", [
    ["📊", "SalesFlow (ordinateur)", "Tableau complet des prospects RMS", "/"],
    ["💬", "SMS reçus & devis", "Répondre, faire et envoyer un devis", "/sms-recus.html"],
    ["🧾", "Devis manuel", "Créer un devis pour un client hors liste", "/devis-manuel.html"],
    ["🚽", "Valider estimations ANC", "Estimations assainissement en attente", "/valider-anc.html"],
    ["🚪", "Page portails", "Ce que voient les clients portails", "https://www.skyeco.fr/portails.html"],
    ["🧮", "Configurateur portails", "Estimation portails en ligne", "https://www.skyeco.fr/devis-portails.html"],
    ["💬", "Réponses réseaux", "Commentaires Facebook / Instagram", `https://www.skyeco.fr/reponses-reseaux.html?id=${RMS_DRAFT}`],
  ]],
  ["Skyeco — les applis que je vends", [
    ["🎬", "Carrousels TikTok", "L'IA crée les pubs TikTok de mes applis", "/carrousel.html"],
    ["🏠", "skyeco.fr", "La page d'accueil de toutes les applis", "https://www.skyeco.fr/"],
    ["🤖", "Mon Assistant Pro", "Mon espace (mails, agenda, paiements, pub)", "https://www.skyeco.fr/mon-assistant-pro/inscription/"],
    ["🏗️", "Contact Chantier", "Suivi de chantier", "https://www.skyeco.fr/contact-chantier/"],
    ["⭐", "Avis Pro", "Gestion des avis Google", "https://www.skyeco.fr/avis-pro/"],
    ["📦", "Kit Pro Artisan", "Kit devis + visuels à 39 €", "https://www.skyeco.fr/kit-pro-artisan-btp.html"],
    ["📐", "Estimateur BTP", "Démo de l'estimateur", "https://www.skyeco.fr/estimateur-btp-demo.html"],
    ["📣", "Skyeco Ads", "Site vitrine + pub Google", "https://www.skyeco.fr/skyeco-ads-landing-nationale.html"],
    ["🚀", "Qui veut me lancer ?", "Plateforme des porteurs de projets", "https://quiveutmelancer.fr/"],
  ]],
  ["Pub, banque, réseaux", [
    ["🎯", "Google Ads", "", "https://ads.google.com/"],
    ["📘", "Meta (Facebook / Instagram)", "Gestionnaire de publicités", "https://adsmanager.facebook.com/"],
    ["📅", "Metricool", "Publications programmées", "https://app.metricool.com/"],
    ["🏦", "Qonto", "Banque", "https://app.qonto.com/"],
    ["📒", "Pennylane", "Compta, devis, factures", "https://app.pennylane.com/"],
    ["✉️", "Gmail", "", "https://mail.google.com/"],
  ]],
];

function MesApplis() {
  return (
    <div style={{ padding: "12px 12px 0" }}>
      {APPLIS.map(([titre, liste]) => (
        <div key={titre} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: .4, margin: "4px 4px 8px" }}>{titre}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {liste.map(([ico, nom, desc, url]) => (
              <a key={nom} href={url} target={url.startsWith("/") ? "_self" : "_blank"} rel="noreferrer"
                style={{ display: "block", background: "#fff", borderRadius: 14, padding: 12, textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,.06)", minHeight: 74 }}>
                <div style={{ fontSize: 24 }}>{ico}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginTop: 4 }}>{nom}</div>
                {desc && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{desc}</div>}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
