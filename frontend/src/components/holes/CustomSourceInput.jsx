import { useState, useRef } from 'react';
import { analyzeCustomScorecard } from '../../services/api.js';

// Panneau de changement de source de scorecard (URL image ou fichier local, analysé
// par IA vision). Partagé entre l'OSM Proxy et la page détail parcours.
export default function CustomSourceInput({ hasDefault, isCustom, osmId, courseKey, onResult, onReset }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  async function runAnalysis(payload) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeCustomScorecard({ ...payload, osmId, courseKey });
      onResult(result);
      setOpen(false);
      setUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUrl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    runAnalysis({ url: url.trim() });
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      runAnalysis({ fileData: base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (!open) {
    return (
      <button
        className="custom-source-toggle"
        onClick={() => setOpen(true)}
        title="Utiliser une autre source de scorecard"
      >
        Changer source
      </button>
    );
  }

  return (
    <div className="custom-source-panel">
      <div className="custom-source-header">
        <span>Changer la source de scorecard</span>
        <button className="custom-source-close" onClick={() => { setOpen(false); setError(null); }}>×</button>
      </div>

      {hasDefault && isCustom && (
        <button className="custom-source-revert" onClick={() => { onReset(); setOpen(false); }}>
          ↩ Revenir à cgolf.fr
        </button>
      )}

      <form className="custom-source-url-row" onSubmit={handleUrl}>
        <input
          className="custom-source-url-input"
          type="url"
          placeholder="https://… (URL image)"
          value={url}
          onChange={e => setUrl(e.target.value)}
          disabled={loading}
        />
        <button className="custom-source-url-btn" type="submit" disabled={loading || !url.trim()}>
          {loading ? '…' : 'Analyser'}
        </button>
      </form>

      <div
        className={`custom-source-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {loading ? 'Analyse en cours…' : 'Glisser une image ici ou cliquer'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>

      {error && <p className="custom-source-error">{error}</p>}
    </div>
  );
}
