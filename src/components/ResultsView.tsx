import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, ChevronRight, FileText, Maximize2, TriangleAlert, X } from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n';
import { DemoNotice } from './VideoUpload';

type DemoEvent = { id: string; type: MessageKey; explanation: MessageKey; time: number };
const demoEvents: DemoEvent[] = [
  { id: 'unattended', type: 'eventOne', explanation: 'explanationOne', time: 12 },
  { id: 'outside-area', type: 'eventTwo', explanation: 'explanationTwo', time: 28 },
];

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function EvidenceGallery({ timestamp }: { timestamp: number }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  return <div className="evidence-gallery">
    <h3>{t('evidence')}</h3>
    <button className="evidence-thumbnail" aria-label={t('enlarge')} onClick={() => { dialog.current?.showModal(); closeButton.current?.focus(); }}>
      <img src="/demo-frame.svg" alt={t('frame')} /><span className="evidence-time">{formatTime(timestamp)}</span><span className="enlarge-icon"><Maximize2 size={14} /></span>
    </button>
    <p className="helper-text">{t('evidenceNote')}</p>
    <dialog ref={dialog} className="evidence-dialog" aria-labelledby="evidence-dialog-title" onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="dialog-heading"><h2 id="evidence-dialog-title">{t('frame')} · {formatTime(timestamp)}</h2><button ref={closeButton} className="icon-button" aria-label={t('close')} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <img src="/demo-frame.svg" alt={t('frame')} /><p>{t('evidenceNote')}</p>
    </dialog>
  </div>;
}

function ViolationDetails({ event }: { event: DemoEvent }) {
  const { t } = useI18n();
  return <section className="violation-details" aria-labelledby="detail-title">
    <h2 id="detail-title">{t('details')}</h2>
    <dl><div><dt>{t('violationType')}</dt><dd>{t(event.type)}</dd></div><div><dt>{t('timestamp')}</dt><dd className="tabular-nums">{formatTime(event.time)}</dd></div><div><dt>{t('explanation')}</dt><dd className="explanation">{t(event.explanation)}</dd></div></dl>
    <EvidenceGallery timestamp={event.time} />
    <div className="regulation"><h3><FileText size={15} />{t('regulation')}</h3><p>{t('reference')}</p><span className="helper-text">{t('referenceNote')}</span></div>
  </section>;
}

export function ResultsView({ file, url, scenario, onNew }: { file: File; url: string; scenario: 'flagged' | 'clear'; onNew: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [selected, setSelected] = useState(demoEvents[0].id);
  const [playbackError, setPlaybackError] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<string | null>(null);
  const flagged = scenario === 'flagged';
  const events = demoEvents.map((event, index) => ({ ...event, time: duration !== null ? Math.min(event.time, Math.floor(duration * (index === 0 ? 0.25 : 0.65))) : event.time }));
  const current = events.find((event) => event.id === selected) ?? events[0];
  useEffect(() => {
    if (pendingSeek !== null && duration !== null && video.current) {
      const index = demoEvents.findIndex((event) => event.id === pendingSeek);
      video.current.currentTime = Math.min(demoEvents[index].time, Math.floor(duration * (index === 0 ? 0.25 : 0.65)));
      setPendingSeek(null);
    }
  }, [duration, pendingSeek]);
  const choose = (event: DemoEvent) => {
    setSelected(event.id);
    if (video.current && duration !== null) video.current.currentTime = event.time;
    else setPendingSeek(event.id);
  };
  return <section className="results-content">
    <div className="page-heading results-heading"><div><h1>{t('results')}</h1><p>{t('resultSubtitle')}</p></div><button className="button button-secondary" onClick={onNew}><ArrowLeft size={16} />{t('newAnalysis')}</button></div>
    <div className={`verdict ${flagged ? 'flagged' : 'clear'}`} role="status">{flagged ? <TriangleAlert size={19} /> : <CheckCircle2 size={19} />}<strong>{t(flagged ? 'verdictFlagged' : 'verdictClear')}</strong><span className="demo-pill">{t('demo')}</span></div>
    <div className="results-grid"><div className="video-column"><div className="panel video-panel"><div className="panel-title"><h2>{t('recording')}</h2><span className="format-tag">MOV</span></div><video key={url} ref={video} src={url} controls playsInline preload="metadata" aria-label={t('recording')} onLoadedMetadata={(e) => { const value = e.currentTarget.duration; if (Number.isFinite(value)) setDuration(value); }} onError={() => setPlaybackError(true)} />{playbackError && <p className="playback-error" role="alert">{t('playbackError')}</p>}<div className="video-footer"><span title={file.name}>{file.name}</span><span className="tabular-nums">{duration !== null ? formatTime(duration) : '—'}</span></div></div><p className="helper-text mt-3">{t('seekNote')}</p><DemoNotice results /></div>
      <div className="panel events-panel">{flagged ? <><section className="violations-list"><div className="panel-title"><h2>{t('events')}</h2><span className="count-badge">{events.length}</span></div><div className="event-buttons">{events.map((event) => <button key={event.id} className={`event-button ${selected === event.id ? 'selected' : ''}`} aria-pressed={selected === event.id} onClick={() => choose(event)}><span className="event-dot" /><span className="flex-1">{t(event.type)}</span><span className="event-time">{formatTime(event.time)}</span><ChevronRight size={15} className="shrink-0" /></button>)}</div></section><ViolationDetails event={current} /></> : <div className="empty-results"><div className="clear-symbol"><Check size={25} /></div><h2>{t('clearTitle')}</h2><p>{t('clearDescription')}</p><span className="demo-pill">{t('demo')}</span></div>}</div>
    </div>
  </section>;
}
