import { useRef, useState, type DragEvent } from 'react';
import { ArrowRight, Check, FileVideo, FlaskConical, LockKeyhole, UploadCloud, X } from 'lucide-react';
import { useI18n } from '../i18n';

export function DemoNotice({ results = false }: { results?: boolean }) {
  const { t } = useI18n();
  return <div className="demo-notice"><FlaskConical size={17} className="shrink-0" /><div><strong>{t('demo')}</strong><p>{t(results ? 'demoResults' : 'demoNotice')}</p></div></div>;
}

export function VideoUpload({ file, onFile, onStart, scenario, setScenario }: {
  file: File | null; onFile: (file: File | null) => void; onStart: () => void;
  scenario: 'flagged' | 'clear'; setScenario: (value: 'flagged' | 'clear') => void;
}) {
  const { t, language } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);
  const accept = (files: FileList | null) => {
    const chosen = files?.[0];
    if (!chosen || files?.length !== 1 || !/\.mov$/i.test(chosen.name) || chosen.size === 0) { setError(true); return; }
    setError(false); onFile(chosen);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); depth.current = 0; setDragging(false); accept(event.dataTransfer.files);
  };
  const size = file ? new Intl.NumberFormat(language, { style: 'unit', unit: file.size >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 }).format(file.size / (file.size >= 1048576 ? 1048576 : 1024)) : '';
  return <section className="upload-content">
    <div className="page-heading"><h1>{t('analysis')}</h1><p>{t('uploadSubtitle')}</p></div>
    <div className="upload-card">
      <div className="card-heading"><h2>{t('uploadTitle')}</h2><span className="format-tag">MOV</span></div>
      <input ref={input} type="file" accept=".mov,video/quicktime" aria-label={t('choose')} className="sr-only" tabIndex={-1} onChange={(e) => { accept(e.target.files); e.target.value = ''; }} />
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragEnter={(e) => { e.preventDefault(); depth.current++; setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => { e.preventDefault(); if (--depth.current <= 0) setDragging(false); }} onDrop={drop}>
        <div className="upload-symbol"><UploadCloud size={28} strokeWidth={1.6} /></div>
        <h3>{t('drop')}</h3><p>{t('or')}</p>
        <button className="button button-secondary" onClick={() => input.current?.click()}><UploadCloud size={16} />{t('choose')}</button>
        <span className="supported">{t('supported')}</span>
      </div>
      {error && <p className="error-message" role="alert">{t('invalid')}</p>}
      {file && <div className="selected-file"><div className="file-icon"><FileVideo size={23} /></div><div className="min-w-0 flex-1"><p className="file-name" title={file.name}>{file.name}</p><p className="file-meta">{size}<span>·</span><Check size={12} />{t('ready')}</p></div><button className="icon-button" aria-label={t('remove')} onClick={() => { onFile(null); setError(false); }}><X size={18} /></button></div>}
      <div className="privacy-note"><LockKeyhole size={14} /><span>{t('local')}</span></div>
    </div>
    <div className="demo-settings"><DemoNotice /><div className="analysis-actions"><label className="scenario-select"><span>{t('scenario')}</span><select value={scenario} onChange={(e) => setScenario(e.target.value as 'flagged' | 'clear')}><option value="flagged">{t('withEvents')}</option><option value="clear">{t('noEvents')}</option></select></label><button className="button button-primary" disabled={!file} onClick={onStart}>{t('start')}<ArrowRight size={17} /></button></div></div>
  </section>;
}
