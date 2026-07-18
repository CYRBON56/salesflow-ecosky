import React, { useState, useEffect } from "react";
import { Phone, MousePointerClick, FileText, RefreshCw, Calendar } from "lucide-react";
import { supabase } from "./supabaseClient.js";

const TEAL = "#0f5c56";
const TEAL_DARK = "#0a3f3c";
const SAND = "#f6f4ef";

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function formatRdv(dateStr) {
  if (!dateStr) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Paris",
    }).format(new Date(dateStr));
  } catch (e) {
    return dateStr;
  }
}
export default function MobileSummary() {
  const [clicks, setClicks] = useState([]);
  const [devisLeads, setDevisLeads] = useState([]);
  const [callbacks, setCallbacks] = useState([]);
  const [rdvLeads, setRdvLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const nowIso = new Date().toISOString();
      const [clicksRes, devisRes, callbacksRes, rdvRes] = await Promise.all([
        supabase.from("web_clicks").select("*").order("created_at", { ascending: false }).limit(50),
        supabase
          .from("leads")
          .select("*")
          .not("estimation_pdf_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("leads")
          .select("*")
          .eq("callback_demande", true)
          .order("callback_demande_le", { ascending: false }),
        supabase
          .from("leads")
          .select("*")
          .not("rdv_date", "is", null)
          .gte("rdv_date", nowIso)
          .order("rdv_date", { ascending: true }),
      ]);
      if (clicksRes.error) throw clicksRes.error;
      if (devisRes.error) throw devisRes.error;
      if (callbacksRes.error) throw callbacksRes.error;
      if (rdvRes.error) throw rdvRes.error;
      setClicks(clicksRes.data || []);
      setDevisLeads(devisRes.data || []);
      setCallbacks(callbacksRes.data || []);
      setRdvLeads(rdvRes.data || []);
    } catch (e) {
      setError("Impossible de charger les données.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("mobile-summary-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "web_clicks" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const clicksToday = clicks.filter((c) => isToday(c.created_at)).length;
  const devisToday = devisLeads.filter((l) => isToday(l.created_at)).length;

  return (
    <div style={{ minHeight: "100vh", background: SAND, fontFamily: "Inter, sans-serif", paddingBottom: 40 }}>
      <div style={{ background: TEAL, color: "white", padding: "20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>SalesFlow — Résumé</div>
        <button onClick={load} style={{ background: "transparent", border: "none", color: "white", padding: 6 }}>
          <RefreshCw size={18} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {error && <div style={{ margin: 16, padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 14 }}>{error}</div>}

      {/* Compteurs du jour */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "16px 16px 4px" }}>
        <StatCard icon={<MousePointerClick size={18} />} label="Clics aujourd'hui" value={clicksToday} color={TEAL} />
        <StatCard icon={<FileText size={18} />} label="Devis aujourd'hui" value={devisToday} color="#0d9488" />
        <StatCard icon={<Phone size={18} />} label="À rappeler" value={callbacks.length} color="#dc2626" urgent={callbacks.length > 0} />
        <StatCard icon={<Calendar size={18} />} label="RDV à venir" value={rdvLeads.length} color="#7c3aed" />
      </div>

      {/* RDV Calendly à venir */}
      <Section title="📅 Rendez-vous à venir" empty={rdvLeads.length === 0} emptyLabel="Aucun rendez-vous à venir">
        {rdvLeads.map((lead) => (
          <div key={lead.id} style={{ ...cardStyle, borderLeft: "4px solid #7c3aed" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: TEAL_DARK, fontSize: 15 }}>{lead.nom}</div>
              <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600 }}>{formatRdv(lead.rdv_date)}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{lead.telephone}</div>
            </div>
            <a href={`tel:${lead.telephone}`} style={callBtnGhost}>
              <Phone size={16} />
            </a>
          </div>
        ))}
      </Section>

      {/* Demandes de rappel en attente */}
      <Section title="📞 Demandes de rappel en attente" empty={callbacks.length === 0} emptyLabel="Aucune demande en attente">
        {callbacks.map((lead) => (
          <div key={lead.id} style={{ ...cardStyle, borderLeft: "4px solid #dc2626" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: TEAL_DARK, fontSize: 15 }}>{lead.nom}</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>{lead.telephone} • {timeAgo(lead.callback_demande_le)}</div>
            </div>
            <a href={`tel:${lead.telephone}`} style={callBtn}>
              <Phone size={16} /> Appeler
            </a>
          </div>
        ))}
      </Section>

      {/* Demandes de devis récentes */}
      <Section title="📄 Demandes de devis récentes" empty={devisLeads.length === 0} emptyLabel="Aucune demande de devis pour l'instant">
        {devisLeads.slice(0, 15).map((lead) => (
          <div key={lead.id} style={cardStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: TEAL_DARK, fontSize: 15 }}>{lead.nom}</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {lead.estimation_numero ? `Devis n°${lead.estimation_numero} • ` : ""}{timeAgo(lead.created_at)}
              </div>
            </div>
            <a href={`tel:${lead.telephone}`} style={callBtnGhost}>
              <Phone size={16} />
            </a>
          </div>
        ))}
      </Section>

      {/* Clics récents */}
      <Section title="🖱️ Clics récents" empty={clicks.length === 0} emptyLabel="Aucun clic pour l'instant">
        {clicks.slice(0, 15).map((c) => (
          <div key={c.id} style={cardStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: TEAL_DARK, fontSize: 14 }}>
                {c.utm_source === "direct" ? "Visite directe" : c.utm_source || "Source inconnue"}
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>{timeAgo(c.created_at)}</div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function StatCard({ icon, label, value, color, urgent }) {
  return (
    <div style={{
      flex: 1, background: "white", borderRadius: 12, padding: "14px 10px", textAlign: "center",
      border: urgent ? `2px solid ${color}` : "1px solid #e7e3d8",
    }}>
      <div style={{ color, marginBottom: 4, display: "flex", justifyContent: "center" }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: TEAL_DARK }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Section({ title, empty, emptyLabel, children }) {
  return (
    <div style={{ padding: "18px 16px 0" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: TEAL_DARK, marginBottom: 8 }}>{title}</div>
      {empty ? (
        <div style={{ fontSize: 13, color: "#94a3b8", padding: "10px 4px" }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

const cardStyle = {
  background: "white",
  borderRadius: 10,
  border: "1px solid #e7e3d8",
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const callBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#dc2626",
  color: "white",
  textDecoration: "none",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const callBtnGhost = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: TEAL,
  textDecoration: "none",
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${TEAL}`,
};
