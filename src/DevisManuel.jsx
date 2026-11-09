import { useState } from "react";

// Composant à intégrer dans le dashboard SalesFlow (App.jsx).
// Reçoit la liste des leads déjà chargée par le dashboard (props.leads),
// chaque lead doit avoir au minimum : id, prenom, nom, email, telephone.

export default function DevisManuel({ leads }) {
  const [leadId, setLeadId] = useState("");
  const [numero, setNumero] = useState("");
  const [montantTtc, setMontantTtc] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null); // { type: 'error'|'success', message }
  const [uploading, setUploading] = useState(false);
  const [devisId, setDevisId] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [sending, setSending] = useState(false);

  const fileToBase64 = (f) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!leadId || !numero || !file) {
      setStatus({ type: "error", message: "Choisis un lead, un numéro de devis et un fichier PDF." });
      return;
    }
    setUploading(true);
    setStatus(null);
    try {
      const pdf_base64 = await fileToBase64(file);
      const resp = await fetch("/api/upload-devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          numero,
          montant_ttc: montantTtc ? parseFloat(montantTtc) : null,
          pdf_base64,
          filename: file.name,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Échec de l'upload");
      setDevisId(data.devis_id);
      setPdfUrl(data.pdf_url);
      setStatus({ type: "success", message: "Devis envoyé sur le serveur. Choisis maintenant les canaux d'envoi ci-dessous." });
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (channels) => {
    if (!devisId) return;
    setSending(true);
    setStatus(null);
    try {
      const resp = await fetch("/api/send-devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devis_id: devisId, channels }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Échec de l'envoi");

      const parts = [];
      if (data.results.email) {
        parts.push(data.results.email.sent ? "email envoyé" : `email non envoyé (${data.results.email.reason})`);
      }
      if (data.results.sms) {
        parts.push(data.results.sms.sent ? "SMS envoyé" : `SMS non envoyé (${data.results.sms.reason})`);
      }
      setStatus({ type: "success", message: parts.join(" — ") });
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setLeadId("");
    setNumero("");
    setMontantTtc("");
    setFile(null);
    setDevisId(null);
    setPdfUrl(null);
    setStatus(null);
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>Envoyer un devis manuel</h2>

      {!devisId && (
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            Client (lead)
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ width: "100%" }}>
              <option value="">— Sélectionner —</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.prenom} {l.nom} — {l.telephone || "sans tél."}
                </option>
              ))}
            </select>
          </label>

          <label>
            Numéro de devis
            <input
              type="text"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="D-2026-08-134"
              style={{ width: "100%" }}
            />
          </label>

          <label>
            Montant TTC (optionnel)
            <input
              type="number"
              step="0.01"
              value={montantTtc}
              onChange={(e) => setMontantTtc(e.target.value)}
              placeholder="7840.80"
              style={{ width: "100%" }}
            />
          </label>

          <label>
            Fichier PDF
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} />
          </label>

          <button type="submit" disabled={uploading}>
            {uploading ? "Envoi en cours..." : "Charger le devis"}
          </button>
        </form>
      )}

      {devisId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p>
            Devis chargé : <a href={pdfUrl} target="_blank" rel="noreferrer">voir le PDF</a>
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleSend(["email"])} disabled={sending}>Envoyer par email</button>
            <button onClick={() => handleSend(["sms"])} disabled={sending}>Envoyer par SMS</button>
            <button onClick={() => handleSend(["email", "sms"])} disabled={sending}>Envoyer les deux</button>
          </div>
          <button onClick={resetForm} style={{ alignSelf: "flex-start" }}>Charger un autre devis</button>
        </div>
      )}

      {status && (
        <p style={{ color: status.type === "error" ? "crimson" : "green", marginTop: 12 }}>
          {status.message}
        </p>
      )}
    </div>
  );
}
