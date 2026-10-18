import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorCode, isAbort, type HistoryPage, type Job } from './api';
import { I18nProvider, errorMessageKey, useI18n } from './i18n';
import { Header, Navigation, type View } from './components/Layout';
import { VideoUpload } from './components/VideoUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';
import { readHistory } from './history';
import { watchJob } from './polling';

function Workspace() {
  const { t, language } = useI18n();
  const [page, setPage] = useState<HistoryPage>({ items: [], total: 0, limit: 20, offset: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [view, setView] = useState<View>('analysis');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [pollRevision, setPollRevision] = useState(0);
  const mounted = useRef(false);
  const uploadLock = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const selection = useRef(0);

  const refreshHistory = useCallback(async (offset = 0) => {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setHistoryLoading(true);
    try {
      const next = await readHistory(offset, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setPage(next); setHistoryError(null);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && !isAbort(error)) setHistoryError(errorCode(error));
    } finally {
      if (mounted.current && !controller.signal.aborted) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    return () => {
      mounted.current = false;
      historyController.current?.abort();
      uploadController.current?.abort();
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (!activeId) return;
    return watchJob(activeId, next => {
      setJob(next); setJobError(null);
      if (next.status !== 'processing') void refreshHistory();
    }, setJobError);
  }, [activeId, pollRevision, refreshHistory]);

  const openHistory = (id: string) => {
    selection.current++;
    setJob(null); setJobError(null); setActiveId(id); setPollRevision(value => value + 1); setView('results');
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  };
  const newAnalysis = () => {
    selection.current++;
    setActiveId(null); setJob(null); setJobError(null); setView('analysis');
  };
  const start = async () => {
    if (!file || uploadLock.current) return;
    uploadLock.current = true;
    const selected = ++selection.current;
    setUploading(true); setUploadError(null); setActiveId(null); setJob(null); setJobError(null);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const jobId = await api.upload(file, controller.signal);
      if (!mounted.current) return;
      setFile(null);
      if (selection.current === selected) openHistory(jobId);
      void refreshHistory();
    } catch (error) {
      if (!mounted.current || isAbort(error)) return;
      setUploadError(errorCode(error));
      // An upload may have reached the server even if its response was lost.
      void refreshHistory();
    } finally {
      uploadLock.current = false;
      if (mounted.current) setUploading(false);
    }
  };
  const navigate = (next: View) => {
    if (next === 'analysis') newAnalysis();
    else if (activeId) setView('results');
    else if (page.items[0]) openHistory(page.items[0].id);
  };
  const nav = { view, onNavigate: navigate, hasResults: page.total > 0 || !!activeId };
  const ambiguousUpload = uploadError && ['NETWORK_ERROR', 'SERVER_UNAVAILABLE', 'INVALID_RESPONSE'].includes(uploadError);
  return <><Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(open => !open)} />
    <div className="app-layout">
      <Navigation {...nav} hidden={!sidebarOpen} history={page.items} activeId={activeId}
        onOpenHistory={record => openHistory(record.id)} loading={historyLoading} error={historyError}
        offset={page.offset} total={page.total} limit={page.limit} onPage={offset => void refreshHistory(offset)}
        onRefresh={() => void refreshHistory(page.offset)} />
      <main>
        {view === 'analysis' && <>
          {uploadError && <div className="upload-content error-message" role="alert">
            <p>{t(errorMessageKey(uploadError))}</p>
            {ambiguousUpload && <p>{t('uploadUncertain')}</p>}
          </div>}
          {uploading ? <ProcessingStatus stage={0} /> : <VideoUpload file={file}
            onFile={value => { setFile(value); setUploadError(null); }} onStart={() => void start()} />}
        </>}
        {view === 'results' && <>
          {job && <div className="history-summary"><h2>{job.filename}</h2><p>{new Date(job.createdAt).toLocaleString(language)}</p></div>}
          {jobError && <div className="error-message" role="alert"><p>{t(errorMessageKey(jobError))}</p>
            <button className="button button-secondary" onClick={() => setPollRevision(value => value + 1)}>{t('retryConnection')}</button></div>}
          {!job && !jobError && <p className="helper-text" role="status">{t('loading')}</p>}
          {job?.status === 'processing' && <ProcessingStatus stage={1} internalStage={job.stage} isDemo={job.isDemo} onBack={newAnalysis} />}
          {job?.status === 'failed' && <section className="upload-content"><div className="processing-card">
            <h1>{t('analysisFailed')}</h1><p className="error-message" role="alert">{t(errorMessageKey(job.errorCode ?? 'PIPELINE_FAILED'))}</p>
            {job.isDemo && <p className="demo-pill">{t('demo')}</p>}
            <button className="button button-secondary" onClick={newAnalysis}>{t('newAnalysis')}</button>
          </div></section>}
          {job?.status === 'done' && <ResultsView key={job.id} job={job} onNew={newAnalysis} />}
        </>}
      </main>
    </div><Navigation {...nav} mobile /></>;
}

export default function App() { return <I18nProvider><Workspace /></I18nProvider>; }
