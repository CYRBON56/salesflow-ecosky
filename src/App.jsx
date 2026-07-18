import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Papa from "papaparse";
import {
  Upload, MessageCircle, FileText, Send, Trash2, Search,
  Settings as SettingsIcon, Phone, X, Check, ChevronDown,
  Users, Filter, Download, RefreshCw, AlertCircle
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
const STAGES = [
  { id: "nouveau", label: "Nouveau", color: "#64748b" },
  { id: "contacte", label: "Contacté", color: "#2563eb" },
  { id: "interesse", label: "Intéressé", color: "#0d9488" },
  { id: "devis_envoye", label: "Devis envoyé", color: "#d97706" },
  { id: "negociation", label: "Négociation", color: "#7c3aed" },
  { id: "client", label: "Client", color: "#059669" },
];
const PERDU = { id: "perdu", label: "Perdu", color: "#94a3b8" };
const ALL_STAGES = [...STAGES, PERDU];
const TEAL = "#0f5c56";
const TEAL_DARK = "#0a3f3c";
const SAND = "#f6f4ef";
const DEFAULT_TEMPLATES = {
  intro: "Bonjour {nom}, ici RMS ECOSKY. Merci pour votre demande, on revient vers vous rapidement pour votre projet. À très vite !",
  catalogue: "Bonjour {nom}, voici notre catalogue EcoSky by RMS : {catalogue_url}\nN'hésitez pas à me dire ce qui vous intéresse, je reste dispo.",
  devis: "Bonjour {nom}, pour vous préparer un chiffrage précis, pourriez-vous nous envoyer quelques photos (ou une courte vidéo) de la zone concernée via ce lien : {devis_url}\nMerci, on revient vers vous rapidement !",
};
const DEFAULT_SETTINGS = {
  catalogueUrl: "https://www.ecoskybyrms.fr/nos-services-et-prestations/catalogue",
  devisUrl: "https://www.ecoskybyrms.fr/devis",
  templates: DEFAULT_TEMPLATES,
};
function normalizeHeader(h) {
  return h
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function guessColumn(headers, candidates) {
  const norm = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));
  for (const c of candidates) {
    const found = norm.find((h) => h.n === c);
    if (found) return found.raw;
  }
  for (const c of candidates) {
    const found = norm.find((h) => h.n.includes(c));
    if (found) return found.raw;
  }
  return null;
}
function normalizePhone(raw) {
  if (!raw) return "";
  let p = raw.toString().replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p.replace("+", "");
  if (p.startsWith("0")) return "33" + p.slice(1);
  if (p.startsWith("33")) return p;
  return p;
}
function fillTemplate(tpl, lead, settings) {
  return tpl
    .replaceAll("{nom}", lead.nom || "")
    .replaceAll("{catalogue_url}", settings.catalogueUrl || "[lien catalogue à renseigner]")
    .replaceAll("{devis_url}", settings.devisUrl || "[lien devis à renseigner]");
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function settingsFromRow(row) {
  return {
    catalogueUrl: row.catalogue_url || "",
    devisUrl: row.devis_url || "",
    templates: row.templates || DEFAULT_TEMPLATES,
  };
}
function settingsToRow(s) {
  return {
    catalogue_url: s.catalogueUrl,
    devis_url: s.devisUrl,
    templates: s.templates,
  };
}
// La table Supabase utilise la colonne "statut", tandis que l'app utilise "stage" en interne.
function mapRowToLead(row) {
  return { ...row, stage: row.statut };
}
export default function SalesFlowSystem() {
  const [leads, setLeads] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [mapping, setMapping] = useState({ nom: "", telephone: "", source: "" });
  const [expandedLead, setExpandedLead] = useState(null);
  const [waData, setWaData] = useState({}); // { [telephone]: { loading, conversation, messages } }
  const [adClicks, setAdClicks] = useState([]);
  const [showClicks, setShowClicks] = useState(false);
  const fileInputRef = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: leadRows, error: leadErr } = await supabase
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false });
        if (leadErr) throw leadErr;
        setLeads((leadRows || []).map(mapRowToLead));
      } catch (e) {
        setError("Impossible de charger les leads depuis Supabase. Vérifie ton URL/clé dans supabaseClient.js.");
      }
      try {
        const { data: settingsRow, error: settingsErr } = await supabase
          .from("settings")
          .select("*")
          .eq("id", 1)
          .single();
        if (settingsErr) throw settingsErr;
        if (settingsRow) setSettings(settingsFromRow(settingsRow));
      } catch (e) {}
      try {
        const { data: clickRows, error: clickErr } = await supabase
          .from("web_clicks")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (clickErr) throw clickErr;
        setAdClicks(clickRows || []);
      } catch (e) {
        // Table pas encore créée ou inaccessible : on n'affiche simplement rien,
        // sans bloquer le reste du dashboard.
      }
      setLoading(false);
    })();
    // Temps réel : un nouveau clic pub apparaît instantanément
    const clicksChannel = supabase
      .channel("web-clicks-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "web_clicks" }, (payload) => {
        setAdClicks((prev) => [payload.new, ...prev]);
      })
      .subscribe();
    // Temps réel : un nouveau lead ajouté par Make.com (ou un autre utilisateur) apparaît instantanément
    const channel = supabase
      .channel("leads-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const lead = mapRowToLead(payload.new);
          setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]));
        } else if (payload.eventType === "UPDATE") {
          const lead = mapRowToLead(payload.new);
          setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
        } else if (payload.eventType === "DELETE") {
          setLeads((prev) => prev.filter((l) => l.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(clicksChannel);
    };
  }, []);
  const persistSettings = useCallback(async (next) => {
    setSettings(next);
    const { error: err } = await supabase.from("settings").update(settingsToRow(next)).eq("id", 1);
    if (err) setError("Erreur de sauvegarde des réglages.");
  }, []);
  const handleFile = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const guessed = {
          nom: guessColumn(headers, ["nom", "name", "prenom nom", "full name", "prenom"]),
          telephone: guessColumn(headers, ["telephone", "tel", "phone", "mobile", "numero"]),
          source: guessColumn(headers, ["campagne", "campaign", "source", "ad set", "ad name"]),
        };
        setMapping(guessed);
        setCsvPreview({ headers, rows: results.data });
        setShowImport(true);
      },
      error: (err) => setError("Erreur de lecture du CSV : " + err.message),
    });
  };
  const confirmImport = async () => {
    if (!mapping.nom || !mapping.telephone) {
      setError("Merci d'indiquer au minimum les colonnes Nom et Téléphone.");
      return;
    }
    const existingPhones = new Set(leads.map((l) => l.telephone));
    const imported = csvPreview.rows
      .map((row) => {
        const nom = (row[mapping.nom] || "").trim();
        const telephone = normalizePhone(row[mapping.telephone] || "");
        if (!nom || !telephone) return null;
        return {
          nom,
          telephone,
          source: mapping.source ? (row[mapping.source] || "").trim() : "",
          statut: "nouveau",
          notes: "",
        };
      })
      .filter(Boolean)
      .filter((l) => !existingPhones.has(l.telephone));
    if (imported.length === 0) {
      setShowImport(false);
      setCsvPreview(null);
      return;
    }
    const { data, error: err } = await supabase.from("leads").insert(imported).select();
    if (err) {
      setError("Erreur lors de l'import dans Supabase : " + err.message);
      return;
    }
    setLeads((prev) => [...(data || []).map(mapRowToLead), ...prev]);
    setShowImport(false);
    setCsvPreview(null);
    setError("");
  };
  const updateLead = async (id, patch) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const dbPatch = { ...patch };
    if ("stage" in dbPatch) {
      dbPatch.statut = dbPatch.stage;
      delete dbPatch.stage;
    }
    const { error: err } = await supabase.from("leads").update(dbPatch).eq("id", id);
    if (err) setError("Erreur de mise à jour du lead.");
  };
  const deleteLead = async (id) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    const { error: err } = await supabase.from("leads").delete().eq("id", id);
    if (err) setError("Erreur de suppression du lead.");
  };
  const loadWhatsApp = useCallback(async (telephone) => {
    setWaData((prev) => ({ ...prev, [telephone]: { ...(prev[telephone] || {}), loading: true } }));
    try {
      const { data: conversation } = await supabase
        .from("wa_conversations")
        .select("*")
        .eq("phone", telephone)
        .maybeSingle();
      const { data: messages } = await supabase
        .from("wa_messages")
        .select("*")
        .eq("phone", telephone)
        .order("created_at", { ascending: true });
      setWaData((prev) => ({
        ...prev,
        [telephone]: { loading: false, conversation: conversation || null, messages: messages || [] },
      }));
    } catch (e) {
      setWaData((prev) => ({ ...prev, [telephone]: { loading: false, conversation: null, messages: [], error: true } }));
    }
  }, []);
  const toggleLead = (lead) => {
    const next = expandedLead === lead.id ? null : lead.id;
    setExpandedLead(next);
    if (next && !waData[lead.telephone]) {
      loadWhatsApp(lead.telephone);
    }
  };
  const openWhatsApp = (lead, templateKey) => {
    const tpl = settings.templates[templateKey] || "";
    const text = fillTemplate(tpl, lead, settings);
    const url = `https://wa.me/${lead.telephone}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    if (templateKey === "intro" && lead.stage === "nouveau") {
      updateLead(lead.id, { stage: "contacte" });
    }
    if (templateKey === "devis" && (lead.stage === "contacte" || lead.stage === "interesse")) {
      updateLead(lead.id, { stage: "devis_envoye" });
    }
  };
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !search ||
        l.nom.toLowerCase().includes(search.toLowerCase()) ||
        l.telephone.includes(search);
      const matchesStage = stageFilter === "all" || l.stage === stageFilter;
      return matchesSearch && matchesStage;
    });
  }, [leads, search, stageFilter]);
  const counts = useMemo(() => {
    const c = {};
    ALL_STAGES.forEach((s) => (c[s.id] = 0));
    leads.forEach((l) => {
      c[l.stage] = (c[l.stage] || 0) + 1;
    });
    return c;
  }, [leads]);
  const exportCsv = () => {
    const csv = Papa.unparse(
      leads.map((l) => ({
        Nom: l.nom,
        Telephone: l.telephone,
        Source: l.source,
        Etape: ALL_STAGES.find((s) => s.id === l.stage)?.label || l.stage,
        Notes: l.notes,
      }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ecosky-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: SAND, fontFamily: "Inter, system-ui, sans-serif", color: TEAL_DARK }}>
        <RefreshCw size={20} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />
        Chargement du SalesFlow...
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: SAND, fontFamily: "'Inter', system-ui, -apple-system, sans-serif", color: "#1e2a28" }}>
      {/* Header */}
      <div style={{ background: TEAL, color: "white", padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", opacity: 0.75, fontWeight: 600 }}>EcoSky by RMS</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>SalesFlow System</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowClicks(true)} style={btnGhost}>
            <MessageCircle size={16} /> Clics pub ({adClicks.length})
          </button>
          <button onClick={() => setShowSettings(true)} style={btnGhost}>
            <SettingsIcon size={16} /> Réglages
          </button>
          <button onClick={exportCsv} style={btnGhost}>
            <Download size={16} /> Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} style={btnPrimary}>
            <Upload size={16} /> Importer un CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
          />
        </div>
      </div>
      {error && (
        <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "10px 28px", display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError("")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#b91c1c" }}>
            <X size={16} />
          </button>
        </div>
      )}
      {/* Stage summary bar */}
      <div style={{ display: "flex", gap: 8, padding: "16px 28px 0", flexWrap: "wrap" }}>
        <button
          onClick={() => setStageFilter("all")}
          style={pill(stageFilter === "all", "#334155")}
        >
          Tous ({leads.length})
        </button>
        {ALL_STAGES.map((s) => (
          <button key={s.id} onClick={() => setStageFilter(s.id)} style={pill(stageFilter === s.id, s.color)}>
            {s.label} ({counts[s.id] || 0})
          </button>
        ))}
      </div>
      {/* Search */}
      <div style={{ padding: "16px 28px 0" }}>
        <div style={{ position: "relative", maxWidth: 340 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "#94a3b8" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un nom ou un numéro..."
            style={{
              width: "100%", padding: "9px 12px 9px 34px", borderRadius: 8,
              border: "1px solid #d9d5c9", fontSize: 14, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
      </div>
      {/* Leads list */}
      <div style={{ padding: 28 }}>
        {leads.length === 0 ? (
          <EmptyState onImport={() => fileInputRef.current?.click()} />
        ) : filtered.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 14, padding: 40, textAlign: "center" }}>
            Aucun lead ne correspond à ta recherche.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                expanded={expandedLead === lead.id}
                onToggle={() => toggleLead(lead)}
                onStageChange={(stage) => updateLead(lead.id, { stage })}
                onNotesChange={(notes) => updateLead(lead.id, { notes })}
                onCallbackHandled={() => updateLead(lead.id, { callback_demande: false })}
                onDelete={() => deleteLead(lead.id)}
                onWhatsApp={(key) => openWhatsApp(lead, key)}
                wa={waData[lead.telephone]}
              />
            ))}
          </div>
        )}
      </div>
      {showImport && csvPreview && (
        <ImportModal
          headers={csvPreview.headers}
          mapping={mapping}
          setMapping={setMapping}
          rowCount={csvPreview.rows.length}
          onCancel={() => {
            setShowImport(false);
            setCsvPreview(null);
          }}
          onConfirm={confirmImport}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(next) => {
            persistSettings(next);
            setShowSettings(false);
          }}
        />
      )}
      {showClicks && (
        <AdClicksModal clicks={adClicks} leads={leads} onClose={() => setShowClicks(false)} />
      )}
    </div>
  );
}
function EmptyState({ onImport }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#5b6b69" }}>
      <Users size={36} style={{ marginBottom: 12, color: TEAL, opacity: 0.6 }} />
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: TEAL_DARK }}>Aucun lead pour l'instant</div>
      <div style={{ fontSize: 14, marginBottom: 18 }}>Importe ton export CSV de leads Facebook Ads pour démarrer.</div>
      <button onClick={onImport} style={btnPrimary}>
        <Upload size={16} /> Importer un CSV
      </button>
    </div>
  );
}
function LeadRow({ lead, expanded, onToggle, onStageChange, onNotesChange, onCallbackHandled, onDelete, onWhatsApp, wa }) {
  const stageInfo = ALL_STAGES.find((s) => s.id === lead.stage) || ALL_STAGES[0];
  return (
    <div style={{ background: "white", borderRadius: 10, border: lead.callback_demande ? "1px solid #dc2626" : "1px solid #e7e3d8", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 14, cursor: "pointer" }} onClick={onToggle}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: stageInfo.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: TEAL_DARK, display: "flex", alignItems: "center", gap: 8 }}>
            {lead.nom}
            {lead.callback_demande && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#fff", background: "#dc2626", borderRadius: 999, padding: "2px 8px" }}>
                <Phone size={10} /> À rappeler
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
            <span><Phone size={11} style={{ verticalAlign: -1 }} /> {lead.telephone}</span>
            {lead.source && <span>• {lead.source}</span>}
            {lead.callback_demande_le && (
              <span>• Demandé le {new Date(lead.callback_demande_le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
            )}
          </div>
        </div>
        <select
          value={lead.stage}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStageChange(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #d9d5c9", background: SAND, color: TEAL_DARK, fontWeight: 500 }}
        >
          {ALL_STAGES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s", color: "#94a3b8" }} />
      </div>
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #f1efe8" }}>
          {lead.callback_demande && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#991b1b", fontWeight: 600 }}>📞 Ce client a demandé à être rappelé</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCallbackHandled(); }}
                style={{ ...btnWA, background: "#fff", color: "#991b1b", border: "1px solid #fecaca" }}
              >
                <Check size={14} /> Marquer comme rappelé
              </button>
            </div>
          )}
          {lead.estimation_pdf_url && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "#f6faf9", border: "1px solid #e2f0ec", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
                Estimation détaillée {lead.estimation_numero ? `n°${lead.estimation_numero}` : ""}
                {lead.estimation_texte ? ` — ${lead.estimation_texte}` : ""}
              </div>
              <a
                href={lead.estimation_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ ...btnWA, textDecoration: "none", display: "inline-flex" }}
              >
                <FileText size={14} /> Voir le PDF estimation
              </a>
              {lead.rdv_date && (
                <div style={{ fontSize: 12, color: "#1e6f4c", fontWeight: 600, marginTop: 8 }}>
                  📅 RDV technicien : {new Date(lead.rdv_date).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => onWhatsApp("intro")} style={btnWA}>
              <MessageCircle size={14} /> Message de prise de contact
            </button>
            <button onClick={() => onWhatsApp("catalogue")} style={btnWA}>
              <FileText size={14} /> Envoyer le catalogue
            </button>
            <button onClick={() => onWhatsApp("devis")} style={btnWA}>
              <Send size={14} /> Demander un devis (photos/vidéo)
            </button>
          </div>
          <WhatsAppHistory wa={wa} />
          <textarea
            value={lead.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Notes sur ce lead..."
            style={{ width: "100%", marginTop: 12, minHeight: 60, padding: 10, borderRadius: 8, border: "1px solid #e7e3d8", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={onDelete} style={{ ...btnGhostSmall, color: "#b91c1c" }}>
              <Trash2 size={13} /> Supprimer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function WhatsAppHistory({ wa }) {
  const [openThread, setOpenThread] = useState(false);
  if (!wa || wa.loading) {
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
        <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
        Chargement des échanges WhatsApp...
      </div>
    );
  }
  if (wa.error) {
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#b91c1c" }}>
        Impossible de charger l'historique WhatsApp pour ce numéro.
      </div>
    );
  }
  if (!wa.conversation || wa.messages.length === 0) {
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "#94a3b8" }}>
        Aucun échange WhatsApp pour ce numéro pour l'instant.
      </div>
    );
  }
  const lastMessage = wa.messages[wa.messages.length - 1];
  const preview = lastMessage.content.length > 90 ? lastMessage.content.slice(0, 90) + "…" : lastMessage.content;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        onClick={() => setOpenThread((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          padding: "8px 10px", borderRadius: 8, background: "#f6faf9", border: "1px solid #e2f0ec",
        }}
      >
        <MessageCircle size={14} style={{ color: TEAL, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: TEAL_DARK }}>
            Échanges WhatsApp ({wa.messages.length} message{wa.messages.length > 1 ? "s" : ""})
          </div>
          <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {lastMessage.role === "assistant" ? "Vous : " : ""}{preview}
          </div>
        </div>
        <ChevronDown size={14} style={{ transform: openThread ? "rotate(180deg)" : "none", transition: "transform 0.15s", color: "#94a3b8", flexShrink: 0 }} />
      </div>
      {openThread && (
        <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: "#fbfaf7", border: "1px solid #f1efe8", maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {wa.messages.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: m.role === "assistant" ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "78%", padding: "7px 11px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.4,
                  background: m.role === "assistant" ? TEAL : "white",
                  color: m.role === "assistant" ? "white" : "#1e2a28",
                  border: m.role === "assistant" ? "none" : "1px solid #e7e3d8",
                }}
              >
                {m.content}
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>
                  {new Date(m.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function ImportModal({ headers, mapping, setMapping, rowCount, onCancel, onConfirm }) {
  return (
    <Modal onClose={onCancel} title="Associer les colonnes du CSV">
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
        {rowCount} lignes détectées. Indique quelle colonne correspond à quoi.
      </div>
      {[
        { key: "nom", label: "Nom du contact *" },
        { key: "telephone", label: "Téléphone *" },
        { key: "source", label: "Campagne / Source (optionnel)" },
      ].map((field) => (
        <div key={field.key} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: TEAL_DARK, display: "block", marginBottom: 4 }}>{field.label}</label>
          <select
            value={mapping[field.key] || ""}
            onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
            style={{ width: "100%", padding: 9, borderRadius: 8, border: "1px solid #d9d5c9", fontSize: 14, boxSizing: "border-box" }}
          >
            <option value="">-- Aucune --</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onCancel} style={btnGhostSmall}>Annuler</button>
        <button onClick={onConfirm} style={btnPrimary}><Check size={15} /> Importer les leads</button>
      </div>
    </Modal>
  );
}
function SettingsModal({ settings, onClose, onSave }) {
  const [local, setLocal] = useState(settings);
  return (
    <Modal onClose={onClose} title="Réglages">
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Lien du catalogue</label>
        <input
          value={local.catalogueUrl}
          onChange={(e) => setLocal({ ...local, catalogueUrl: e.target.value })}
          placeholder="https://ecoskybyrms.fr/catalogue"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Lien de la page devis (photos/vidéo)</label>
        <input
          value={local.devisUrl}
          onChange={(e) => setLocal({ ...local, devisUrl: e.target.value })}
          placeholder="https://ecoskybyrms.fr/devis"
          style={inputStyle}
        />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEAL_DARK, marginBottom: 8 }}>Modèles de messages WhatsApp</div>
      {[
        { key: "intro", label: "Prise de contact" },
        { key: "catalogue", label: "Envoi du catalogue" },
        { key: "devis", label: "Demande de devis" },
      ].map((t) => (
        <div key={t.key} style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t.label}</label>
          <textarea
            value={local.templates[t.key]}
            onChange={(e) => setLocal({ ...local, templates: { ...local.templates, [t.key]: e.target.value } })}
            style={{ ...inputStyle, minHeight: 70, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>
      ))}
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
        Variables disponibles : {"{nom}"}, {"{catalogue_url}"}, {"{devis_url}"}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhostSmall}>Annuler</button>
        <button onClick={() => onSave(local)} style={btnPrimary}><Check size={15} /> Enregistrer</button>
      </div>
    </Modal>
  );
}
function AdClicksModal({ clicks, leads, onClose }) {
  const totalClicks = clicks.length;
  const totalLeadsFromAds = leads.filter((l) => (l.ad_id || (l.source || "").toLowerCase().includes("facebook"))).length;
  const conversionRate = totalClicks > 0 ? Math.round((totalLeadsFromAds / totalClicks) * 100) : 0;

  return (
    <Modal onClose={onClose} title="Clics publicité Facebook">
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <StatCard label="Clics enregistrés" value={totalClicks} />
        <StatCard label="Leads issus d'une pub" value={totalLeadsFromAds} />
        <StatCard label="Taux clic → lead" value={`${conversionRate}%`} />
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
        Un "clic" est enregistré dès qu'un visiteur arrive sur le site depuis une
        publicité (avec fbclid ou paramètre utm), même s'il ne discute jamais
        avec Skyeco ni ne devient un lead. Le taux ci-dessus est une estimation
        globale (les leads ne sont pas toujours reliés au clic web précis dont
        ils viennent, notamment pour le Click-to-WhatsApp direct).
      </div>
      {totalClicks === 0 ? (
        <div style={{ fontSize: 13.5, color: "#94a3b8", textAlign: "center", padding: "24px 0" }}>
          Aucun clic enregistré pour l'instant. Vérifie que la table
          "web_clicks" existe bien dans Supabase et que le widget du site
          pointe vers le bon endpoint de suivi.
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #f1efe8", borderRadius: 10 }}>
          {clicks.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "10px 12px", borderBottom: "1px solid #f1efe8", fontSize: 12.5,
                display: "flex", flexDirection: "column", gap: 3,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600, color: TEAL_DARK }}>
                  {c.ad_id ? `Annonce ${c.ad_id}` : (c.utm_campaign || "Source inconnue")}
                </span>
                <span style={{ color: "#94a3b8", flexShrink: 0 }}>
                  {new Date(c.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={{ color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.landing_page || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={btnGhostSmall}>Fermer</button>
      </div>
    </Modal>
  );
}
function StatCard({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: "#f6faf9", border: "1px solid #e2f0ec", borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: TEAL_DARK }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "#64748b" }}>{label}</div>
    </div>
  );
}
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,25,24,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 14, padding: 24, width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: TEAL_DARK }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const labelStyle = { fontSize: 13, fontWeight: 600, color: TEAL_DARK, display: "block", marginBottom: 4 };
const inputStyle = { width: "100%", padding: 9, borderRadius: 8, border: "1px solid #d9d5c9", fontSize: 14, boxSizing: "border-box" };
const btnPrimary = {
  display: "flex", alignItems: "center", gap: 6, background: "white", color: TEAL,
  border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnGhost = {
  display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", color: "white",
  border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
};
const btnGhostSmall = {
  display: "flex", alignItems: "center", gap: 5, background: "none", color: "#475569",
  border: "1px solid #d9d5c9", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 500, cursor: "pointer",
};
const btnWA = {
  display: "flex", alignItems: "center", gap: 6, background: "#e6f4f1", color: TEAL_DARK,
  border: "1px solid #cbe8e2", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
function pill(active, color) {
  return {
    padding: "6px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${active ? color : "#e7e3d8"}`,
    background: active ? color : "white",
    color: active ? "white" : "#475569",
  };
}
