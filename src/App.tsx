import { RotateCcw } from 'lucide-react';
import { HistoryActions } from './components/HistoryActions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorCode, isAbort, type HistoryPage, type Job, type JobSummary } from './api';
import { I18nProvider, errorMessageKey, useI18n } from './i18n';
import { Header, Navigation, type View } from './components/Layout';
import { VideoUpload } from './components/VideoUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';
import { BatchNavigation } from './components/BatchNavigation';
import type { UploadVideo } from './uploads';
import { readHistory } from './history';
import { watchJob } from './polling';

function Workspace() {
  const { t, language } = useI18n();
  const [page, setPage] = useState<HistoryPage>({ items: [], total: 0, limit: 20, offset: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [view, setView] = useState<View>('analysis');
  const [files, setFiles] = useState<UploadVideo[]>([]);
  const [request, setRequest] = useState('');
  const [uploadSession, setUploadSession] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [pollRevision, setPollRevision] = useState(0);
  const [batch, setBatch] = useState<JobSummary[]>([]);
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const uploadLock = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const autoOpen = useRef(false);
  const active = useRef(activeId); active.current = activeId;
  const group = useRef<string | null>(null);
  const ignored = useRef(new Set<string>());

  const refreshHistory = useCallback(async (offset = 0) => {
    historyController.current?.abort();
    const controller = new AbortController(); historyController.current = controller;
    setHistoryLoading(true);
    try {
      const next = await readHistory(offset, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setPage(next); setHistoryError(null);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && !isAbort(error)) setHistoryError(errorCode(error));
    } finally { if (mounted.current && !controller.signal.aborted) setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true; void refreshHistory();
    return () => { mounted.current = false; historyController.current?.abort(); uploadController.current?.abort(); };
  }, [refreshHistory]);

  const receive = useCallback((next: Job) => {
    if (!mounted.current || ignored.current.has(next.id)) return;
    setJobs(current => ({ ...current, [next.id]: next }));
    setJobErrors(current => { const copy = { ...current }; delete copy[next.id]; return copy; });
    setPage(current => ({ ...current, items: current.items.map(item => item.id === next.id ? next : item) }));
    setBatch(current => current.map(item => item.id === next.id ? next : item));
    if (next.status === 'done') {
      if (autoOpen.current) {
        autoOpen.current = false; setActiveId(next.id); setView('results');
        setViewed(current => new Set(current).add(next.id));
      } else if (active.current !== next.id) setNotice(next.filename);
    }
    if (next.status !== 'processing') void refreshHistory();
  }, [refreshHistory]);
  const watchIds = [...new Set([
    ...(activeId ? [activeId] : []),
    ...page.items.filter(item => item.status === 'processing').map(item => item.id),
    ...Object.values(jobs).filter(item => item.status === 'processing').map(item => item.id),
    ...batch.filter(item => item.status === 'processing').map(item => item.id),
  ])].sort().join(',');
  useEffect(() => {
    const stops = watchIds.split(',').filter(Boolean).map(id => watchJob(id, receive,
      code => setJobErrors(current => ({ ...current, [id]: code }))));
    return () => stops.forEach(stop => stop());
  }, [watchIds, pollRevision, receive]);

  const openHistory = (id: string) => {
    const version = ++selection.current;
    autoOpen.current = false; setActiveId(id); setView('results');
    setViewed(current => new Set(current).add(id)); setNotice(''); setPollRevision(value => value + 1);
    const summary = jobs[id] ?? page.items.find(item => item.id === id) ?? batch.find(item => item.id === id);
    group.current = summary?.batchId ?? null;
    setBatch(summary ? [summary] : []);
    if (summary?.batchId) void api.batch(summary.batchId).then(items => {
      if (mounted.current && selection.current === version) setBatch(items);
    }).catch(error => { if (mounted.current && selection.current === version) setJobErrors(current => ({ ...current, [id]: errorCode(error) })); });
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  };
  const newAnalysis = () => {
    selection.current++; autoOpen.current = false; group.current = null;
    setActiveId(null); setBatch([]); setView('analysis'); setFiles([]); setRequest(''); setUploadError(null); setNotice('');
    setUploadSession(value => value + 1);
  };
  const start = async () => {
    if (!files.length || uploadLock.current) return;
    const snapshot = files, analysisRequest = request.trim();
    const version = ++selection.current;
    autoOpen.current = true; uploadLock.current = true;
    setUploading(true); setUploadError(null); setActiveId(null); setBatch([]); setView('results'); setNotice('');
    const controller = new AbortController(); uploadController.current = controller;
    try {
      const batchId = snapshot.length > 1 ? await api.createBatch() : undefined;
      if (selection.current === version) group.current = batchId ?? null;
      for (const upload of snapshot) {
        if (controller.signal.aborted) break;
        try {
          const id = await api.upload(upload.file, controller.signal, { batchId, displayName: upload.displayName, request: analysisRequest });
          if (!mounted.current) return;
          const next = await api.job(id, controller.signal);
          if (!mounted.current) return;
          if (selection.current === version) {
            setBatch(current => [...current.filter(item => item.id !== id), next]);
            setActiveId(current => current ?? id);
          }
          receive(next);
        } catch (error) {
          if (isAbort(error) || !mounted.current) break;
          setUploadError(errorCode(error));
          // Unknown POST delivery is never automatically retried. The next independent file may proceed.
          void refreshHistory();
        }
      }
      if (mounted.current) setFiles([]);
    } catch (error) { if (mounted.current && !isAbort(error)) setUploadError(errorCode(error)); }
    finally { uploadLock.current = false; if (mounted.current) { setUploading(false); void refreshHistory(); } }
  };
  const actOnJob = async (id: string, action: 'cancel' | 'restore') => {
    try { const next = await api[action](id); receive(next); setPollRevision(value => value + 1); }
    catch (error) { setJobErrors(current => ({ ...current, [id]: errorCode(error) })); }
  };
  const removeHistory = async (record: JobSummary) => {
    await api.delete(record.id);
    ignored.current.add(record.id);
    setJobs(current => { const copy = { ...current }; delete copy[record.id]; return copy; });
    setBatch(current => current.filter(item => item.id !== record.id));
    setPage(current => ({ ...current, total: Math.max(0, current.total - 1), items: current.items.filter(item => item.id !== record.id) }));
    if (active.current === record.id) {
      const next = batch.find(item => item.id !== record.id && item.status === 'done') ?? page.items.find(item => item.id !== record.id);
      if (next) openHistory(next.id); else { setActiveId(null); setBatch([]); }
    }
    void refreshHistory(Math.max(0, page.offset >= page.total - 1 ? page.offset - page.limit : page.offset));
  };
  const navigate = (next: View) => {
    if (next === 'analysis') newAnalysis();
    else if (page.items[0]) openHistory(page.items[0].id);
    else if (activeId) setView('results');
  };
  const job = activeId ? jobs[activeId] : undefined;
  const jobError = activeId ? jobErrors[activeId] : undefined;
  const nav = { view, onNavigate: navigate, hasResults: page.total > 0 || !!activeId };
  const processing = view === 'results' && (!job || job.status === 'processing') && (uploading || job?.status === 'processing');
  return <><Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(open => !open)} />
    <div className="app-layout"><Navigation {...nav} hidden={!sidebarOpen} history={page.items} activeId={activeId}
      onOpenHistory={record => openHistory(record.id)} onDeleteHistory={removeHistory} loading={historyLoading} error={historyError}
      offset={page.offset} total={page.total} limit={page.limit} onPage={offset => void refreshHistory(offset)} onRefresh={() => void refreshHistory(page.offset)} />
      <main>
        {uploadError && <div className="upload-content error-message" role="alert"><p>{t(errorMessageKey(uploadError))}</p>{['NETWORK_ERROR', 'SERVER_UNAVAILABLE', 'INVALID_RESPONSE'].includes(uploadError) && <p>{t('uploadUncertain')}</p>}</div>}
        {view === 'analysis' && <VideoUpload key={uploadSession} files={files} onFiles={setFiles} request={request} onRequest={setRequest} busy={uploading} onStart={() => void start()} />}
        {view === 'results' && <>
          {job && !processing && <div className="history-summary"><h2>{job.filename}</h2><p>{new Date(job.createdAt).toLocaleString(language)}</p>{job.analysisRequest && <p className="history-request">{job.analysisRequest}</p>}</div>}
          {notice && <p className="helper-text" role="status">{t('queueReady')}: {notice}</p>}
          {!processing && <BatchNavigation items={batch} activeId={activeId} viewed={viewed} onOpen={openHistory} onAction={actOnJob} onDelete={removeHistory} />}
          {jobError && <div className="error-message" role="alert"><p>{t(errorMessageKey(jobError))}</p><button className="button button-secondary" onClick={() => setPollRevision(value => value + 1)}>{t('retryConnection')}</button></div>}
          {processing && <ProcessingStatus stage={job ? 1 : 0} internalStage={job?.stage} isDemo={job?.isDemo} onBack={newAnalysis} onCancel={job?.status === 'processing' ? () => void actOnJob(job.id, 'cancel') : undefined} />}
          {!job && !processing && !jobError && <p className="helper-text" role="status">{activeId ? t('loading') : t('emptyResultsHistory')}</p>}
          {job?.status === 'failed' && <section className="upload-content"><div className="processing-card"><h1>{t('analysisFailed')}</h1><p className="error-message" role="alert">{t(errorMessageKey(job.errorCode ?? 'PIPELINE_FAILED'))}</p>{job.isDemo && <p className="demo-pill">{t('demo')}</p>}<button className="button button-secondary" onClick={() => void actOnJob(job.id, 'restore')}>{t('retryVideo')}</button></div></section>}
          {job?.status === 'cancelled' && <div className="panel cancelled-video-state"><p>{t('videoCancelledMessage')}</p><div className="cancelled-video-actions"><button className="button button-secondary queue-restore" onClick={() => void actOnJob(job.id, 'restore')}><RotateCcw size={14} />{t('restoreVideo')}</button><HistoryActions record={job} onDelete={() => removeHistory(job)} /></div></div>}
          {job?.status === 'done' && <ResultsView key={`${job.id}:${job.attempt}`} job={job} onNew={newAnalysis} />}
        </>}
      </main></div><Navigation {...nav} mobile /></>;
}
export default function App() { return <I18nProvider><Workspace /></I18nProvider>; }
