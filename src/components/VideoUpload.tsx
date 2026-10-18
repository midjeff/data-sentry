import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, Check, FileVideo, FlaskConical, LockKeyhole, UploadCloud, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { addUpload, hasDuplicateFilename, type UploadVideo } from '../uploads';
import { isSupportedVideo, VIDEO_ACCEPT } from '../videoFormats';

export function DemoNotice({ results = false }: { results?: boolean }) {
  const { t } = useI18n();
  return <div className="demo-notice"><FlaskConical size={17} className="shrink-0" /><div><strong>{t('demo')}</strong><p>{t(results ? 'demoResults' : 'demoNotice')}</p></div></div>;
}

export function VideoUpload({ files, onFiles, onStart, request, onRequest, busy = false }: {
  busy?: boolean; request: string; onRequest: (value: string) => void;
  files: UploadVideo[]; onFiles: (files: UploadVideo[]) => void; onStart: () => void;
}) {
  const { t, language } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const [pending, setPending] = useState<File[]>([]);
  useEffect(() => {
    if (pending.length && !dialog.current?.open) dialog.current?.showModal();
    else if (!pending.length) dialog.current?.close();
  }, [pending]);
  const drain = (current: UploadVideo[], incoming: File[]) => {
    let next = current;
    for (let index = 0; index < incoming.length; index++) {
      if (hasDuplicateFilename(next, incoming[index])) {
        onFiles(next); setPending(incoming.slice(index)); return;
      }
      next = addUpload(next, incoming[index]);
    }
    onFiles(next); setPending([]);
  };
  const decideDuplicate = (confirmed: boolean) => {
    const [file, ...rest] = pending;
    if (!file) return;
    drain(confirmed ? addUpload(files, file, true) : files, rest);
  };
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);
  const accept = (selected: FileList | null) => {
    const incoming = Array.from(selected ?? []);
    const valid = incoming.filter(isSupportedVideo);
    setError(valid.length !== incoming.length);
    if (valid.length) drain(files, valid);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); depth.current = 0; setDragging(false); accept(event.dataTransfer.files);
  };
  const size = (file: File) => new Intl.NumberFormat(language, { style: 'unit', unit: file.size >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 }).format(file.size / (file.size >= 1048576 ? 1048576 : 1024));
  return <section className="upload-content">
    <div className="page-heading"><h1>{t('analysis')}</h1><p>{t('uploadSubtitle')}</p></div>
    <div className="upload-card">
      <div className="card-heading"><h2>{t('uploadTitle')}</h2></div>
      <input ref={input} type="file" multiple accept={VIDEO_ACCEPT} aria-label={t('choose')} className="sr-only" tabIndex={-1} onChange={(e) => { accept(e.target.files); e.target.value = ''; }} />
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragEnter={(e) => { e.preventDefault(); depth.current++; setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => { e.preventDefault(); if (--depth.current <= 0) setDragging(false); }} onDrop={drop}>
        <div className="upload-symbol"><UploadCloud size={28} strokeWidth={1.6} /></div>
        <h3>{t('drop')}</h3><p>{t('or')}</p>
        <button className="button button-secondary" onClick={() => input.current?.click()}><UploadCloud size={16} />{t('choose')}</button>
        <span className="supported">{t('supported')}</span>
      </div>
      {error && <p className="error-message" role="alert">{t('batchInvalid')}</p>}
      {files.map((upload) => <div key={upload.id} className="selected-file"><div className="file-icon"><FileVideo size={23} /></div><div className="min-w-0 flex-1"><p className="file-name" title={upload.displayName}>{upload.displayName}</p><p className="file-meta">{size(upload.file)}<span>·</span><Check size={12} />{t('ready')}</p></div><button className="icon-button" aria-label={t('remove')} onClick={() => { onFiles(files.filter((item) => item.id !== upload.id)); setError(false); }}><X size={18} /></button></div>)}
      {files.length > 1 && <button className="button button-secondary clear-files" onClick={() => { onFiles([]); setError(false); if (input.current) input.current.value = ''; }}>{t('clearAll')}</button>}
      <label className="request-field"><span>{t('analysisRequest')}</span><textarea value={request} onChange={(e) => onRequest(e.target.value)} placeholder={t('requestPlaceholder')} rows={3} maxLength={4000} /></label>
      <div className="privacy-note"><LockKeyhole size={14} /><span>{t('local')}</span></div>
    </div>
    <div className="demo-settings"><p className="helper-text">{t('serverValidation')}</p><div className="analysis-actions"><button className="button button-primary" disabled={!files.length || busy} onClick={onStart}>{files.length > 1 ? t('analyzeMany').replace('{count}', String(files.length)) : t('analyzeOne')}<ArrowRight size={17} /></button></div></div>
    <dialog ref={dialog} className="duplicate-dialog" aria-labelledby={dialogTitle} onCancel={(event) => { event.preventDefault(); decideDuplicate(false); }}>
      <h2 id={dialogTitle}>Файл с таким названием уже добавлен. Хотите добавить его повторно?</h2>
      <p className="duplicate-filename">{pending[0]?.name}</p>
      <div className="duplicate-actions"><button type="button" autoFocus className="button button-secondary" onClick={() => decideDuplicate(false)}>Отмена</button><button type="button" className="button button-primary" onClick={() => decideDuplicate(true)}>Всё равно добавить</button></div>
    </dialog>
  </section>;
}
