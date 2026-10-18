import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, ChevronRight, FileText, Maximize2, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { DemoNotice } from './VideoUpload';
import { videoFormatLabel } from '../videoFormats';
import { videoUrl, type Evidence, type Job, type Violation } from '../api';

export function formatTime(seconds: number) {
  const [whole, fraction] = (seconds % 60).toFixed(3).split('.');
  const decimals = fraction.replace(/0+$/, '');
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${whole.padStart(2, '0')}${decimals ? `.${decimals}` : ''}`;
}

function EvidenceGallery({ frames }: { frames: Evidence[] }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) {
      dialog.current.showModal(); closeButton.current?.focus();
    }
  }, [selected]);
  const failed = (id: string) => setUnavailable(previous => new Set([...previous, id]));
  return <div className="evidence-gallery">
    <h3>{t('evidence')}</h3>
    <div className="evidence-frames">{frames.map(frame => unavailable.has(frame.id)
      ? <p key={frame.id} className="helper-text" role="status">{t('evidenceUnavailable')} · {formatTime(frame.timestamp)}</p>
      : <button key={frame.id} className="evidence-thumbnail" aria-label={`${t('enlarge')} ${formatTime(frame.timestamp)}`} onClick={() => setSelected(frame)}>
        <img src={frame.url} alt={`${t('frame')} ${formatTime(frame.timestamp)}`} onError={() => failed(frame.id)} />
        <span className="evidence-time">{formatTime(frame.timestamp)}</span><Maximize2 className="enlarge-icon" size={20} />
      </button>)}</div>
    <p className="helper-text">{t('evidenceNote')}</p>
    <dialog ref={dialog} className="evidence-dialog" aria-labelledby="evidence-dialog-title" onClose={() => setSelected(null)}
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="dialog-heading"><h2 id="evidence-dialog-title">{t('frame')} · {selected ? formatTime(selected.timestamp) : ''}</h2>
        <button ref={closeButton} className="icon-button" aria-label={t('close')} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {selected && (unavailable.has(selected.id) ? <p role="status">{t('evidenceUnavailable')}</p> :
        <img src={selected.url} alt={t('frame')} onError={() => failed(selected.id)} />)}
    </dialog>
  </div>;
}

function ViolationDetails({ event }: { event: Violation }) {
  const { t } = useI18n();
  return <section className="violation-details"><h2>{t('details')}</h2>
    <dl><div><dt>{t('violationType')}</dt><dd>{event.type}</dd></div>
      <div><dt>{t('timestamp')}</dt><dd className="tabular-nums">{formatTime(event.timestamp)}</dd></div>
      <div><dt>{t('explanation')}</dt><dd className="explanation">{event.description}</dd></div></dl>
    <EvidenceGallery key={event.evidence.map(frame => frame.id).join('-')} frames={event.evidence} />
    {event.regulatoryReferences.length > 0 && <div className="regulation"><h3><FileText size={15} />{t('regulation')}</h3>
      {event.regulatoryReferences.map((reference, index) => <dl key={index}>{Object.entries(reference).map(([key, value]) =>
        <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl>)}</div>}
  </section>;
}

export function ResultsView({ job, onNew }: { job: Job & { status: 'done' }; onNew: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [metadataReady, setMetadataReady] = useState(false);
  const [selected, setSelected] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const pendingSeek = useRef<number | null>(null);
  const { result } = job;
  const flagged = result.verdict === 'violation';
  const current = result.violations[selected];
  const seek = (timestamp: number) => {
    if (metadataReady && video.current) { video.current.currentTime = timestamp; pendingSeek.current = null; }
    else pendingSeek.current = timestamp;
  };
  const choose = (index: number) => { setSelected(index); seek(result.violations[index].timestamp); };
  return <section className="results-content">
    <div className="page-heading results-heading"><div><h1>{t('results')}</h1><p>{t('resultSubtitle')}</p></div>
      <button className="button button-secondary" onClick={onNew}><ArrowLeft size={16} />{t('newAnalysis')}</button></div>
    <div className={`verdict ${flagged ? 'flagged' : 'clear'}`} role="status">
      {flagged ? <TriangleAlert size={19} /> : <CheckCircle2 size={19} />}<strong>{t(flagged ? 'verdictFlagged' : 'verdictClear')}</strong>
      {job.isDemo && <span className="demo-pill">{t('demo')}</span>}
    </div>
    <div className="results-grid"><div className="video-column"><div className="panel video-panel">
      <div className="panel-title"><h2>{t('recording')}</h2><span className="format-tag">{videoFormatLabel({ name: job.filename })}</span></div>
      <video ref={video} src={videoUrl(job.id)} controls playsInline preload="metadata" aria-label={t('recording')}
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault(); const player = event.currentTarget;
          if (Number.isFinite(player.duration)) player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + (event.key === 'ArrowLeft' ? -5 : 5)));
        } }}
        onLoadedMetadata={() => { setMetadataReady(true); if (pendingSeek.current !== null && video.current) {
          video.current.currentTime = pendingSeek.current; pendingSeek.current = null;
        } }}
        onLoadedData={() => setPlaybackError(false)} onError={() => setPlaybackError(true)} />
      {playbackError && <p className="playback-error" role="alert">{t('playbackError')}</p>}
      <div className="video-footer"><span title={job.filename}>{job.filename}</span><span className="tabular-nums">{formatTime(result.duration)}</span></div>
    </div><p className="helper-text mt-3">{t('seekNote')}</p>{job.isDemo && <DemoNotice results />}</div>
    <div className="panel events-panel">{flagged ? <>
      <section className="violations-list"><div className="panel-title"><h2>{t('events')}</h2><span className="count-badge">{result.violations.length}</span></div>
        <div className="event-buttons">{result.violations.map((event, index) => <button key={index}
          className={`event-button ${selected === index ? 'selected' : ''}`} aria-pressed={selected === index} onClick={() => choose(index)}>
          <span className="event-dot" /><span className="flex-1">{event.type}</span><span className="event-time">{formatTime(event.timestamp)}</span><ChevronRight size={16} /></button>)}</div>
      </section><ViolationDetails event={current} />
    </> : <div className="empty-results"><div className="clear-symbol"><Check size={25} /></div><h2>{t('clearTitle')}</h2>
      <p>{t('clearDescription')}</p>{job.isDemo && <span className="demo-pill">{t('demo')}</span>}</div>}</div></div>
  </section>;
}
