import { useEffect, useRef, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { Header, Navigation, type View } from './components/Layout';
import { VideoUpload } from './components/VideoUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';

import { analyzeDemoVideo, type DemoContext } from './analysis';
import type { UploadVideo } from './uploads';
import { readQueue, saveQueue } from './queueStorage';
import { VideoQueueNavigation } from './components/VideoQueueNavigation';
import { runLiveVideoQueue, resultNavigationItems, shouldOpenCompletedResult, type BatchVideo } from './batch';
import { readHistory, saveAnalysis, deleteAnalysis, type AnalysisRecord } from './history';

function Workspace() {
  const { t, language } = useI18n();
  const deletedIds = useRef(new Set<string>());
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let mounted = true;
    readHistory().then((items) => { if (mounted) setHistory((current) => [...new Map([...items, ...current].filter((item) => !deletedIds.current.has(item.id)).map((item) => [item.id, item])).values()].sort((a, b) => b.createdAt - a.createdAt)); }).catch(() => { if (mounted) setHistoryError(true); });
    return () => { mounted = false; };
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [view, setView] = useState<View>('analysis');
  const [uploadSession, setUploadSession] = useState(0);
  const [files, setFiles] = useState<UploadVideo[]>([]);
  const [batch, setBatchState] = useState<BatchVideo[]>([]);
  const batchRef = useRef<BatchVideo[]>([]);
  const setBatch = (update: BatchVideo[] | ((items: BatchVideo[]) => BatchVideo[])) => {
    const items = typeof update === 'function' ? update(batchRef.current) : update;
    batchRef.current = items; setBatchState(items);
  };
  const [queueLoaded, setQueueLoaded] = useState(false);
  const activeJob = useRef<{ id: string; controller: AbortController } | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const demoContext = useRef<DemoContext>({ batchId: '', request: '', scenario: 'flagged' });
  const [viewedVideos, setViewedVideos] = useState<Set<string>>(() => new Set());
  const autoOpen = useRef(true);
  const running = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const [url, setUrl] = useState('');
  const [scenario, setScenario] = useState<'flagged' | 'clear'>('flagged');
  const [resultScenario, setResultScenario] = useState<'flagged' | 'clear'>('flagged');
  const [hasResults, setHasResults] = useState(false);
  const [stage, setStage] = useState<number | null>(null);

  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const localUrl = URL.createObjectURL(file);
    setUrl(localUrl);
    return () => URL.revokeObjectURL(localUrl);
  }, [file]);

  useEffect(() => {
    let mounted = true;
    readQueue().then((snapshot) => {
      if (!mounted) return;
      if (snapshot?.items.length) {
        demoContext.current = snapshot.context; setBatch(snapshot.items);
        for (const item of snapshot.items) {
          if (item.status === 'cancelled') persistQueueRecord(item, snapshot.context);
        }
        const selected = snapshot.items.find((item) => item.status === 'completed') ?? snapshot.items.find((item) => item.status !== 'cancelled');
        setActiveId(selected?.id ?? null);
        if (selected?.status === 'completed' && selected.result) {
          setFile(selected.result.file); setRequest(selected.result.request);
          setResultScenario(selected.result.scenario); setHasResults(true);
        }
        setView('results'); autoOpen.current = false;
      }
    }).catch(() => { if (mounted) setHistoryError(true); }).finally(() => { if (mounted) setQueueLoaded(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (queueLoaded) void saveQueue({ items: batch, context: { ...demoContext.current } }).catch(() => setHistoryError(true));
  }, [batch, queueLoaded]);
  const persistQueueRecord = (item: BatchVideo, context = demoContext.current) => {
    const existing = currentHistory.current.find((record) => record.id === item.id);
    const record: AnalysisRecord = { id: item.id, batchId: item.batchId ?? context.batchId,
      createdAt: existing?.createdAt ?? item.createdAt ?? Date.now(), file: item.file,
      displayName: item.displayName, originalFilename: item.originalFilename ?? item.file.name,
      needsFile: item.needsFile, status: item.status,
      request: item.request ?? existing?.request ?? context.request,
      scenario: item.scenario ?? existing?.scenario ?? context.scenario };
    setHistory((items) => [record, ...items.filter((entry) => entry.id !== record.id)].sort((a, b) => b.createdAt - a.createdAt));
    void saveAnalysis(record).catch(() => setHistoryError(true));
  };
  const cancelVideo = (id: string) => {
    const item = batchRef.current.find((entry) => entry.id === id);
    if (!item || !['pending', 'processing'].includes(item.status)) return;
    const cancelled: BatchVideo = { ...item, status: 'cancelled', result: undefined };
    setBatch((items) => items.map((entry) => entry.id === id ? cancelled : entry));
    persistQueueRecord(cancelled);
    if (activeJob.current?.id === id) activeJob.current.controller.abort();
    if (currentSelection.current === id) { setActiveId(null); setFile(null); setHasResults(false); }
  };
  const cancelProcessing = () => {
    for (const item of batchRef.current) cancelVideo(item.id);
    setShowScanner(false); setView('results');
  };
  const processBatch = async (_items: BatchVideo[], initial = false) => {
    if (running.current) return;
    const controller = new AbortController(); running.current = controller;
    const context = { ...demoContext.current };
    setQueueRunning(true); setShowScanner(initial); setStage(0);
    try {
      await runLiveVideoQueue(() => batchRef.current, controller.signal,
        (item, signal) => analyzeDemoVideo(item, signal, { batchId: item.batchId ?? context.batchId, request: item.request ?? context.request, scenario: item.scenario ?? context.scenario }),
        (item) => {
          setBatch((items) => items.map((entry) => entry.id === item.id ? item : entry));
          if (!item.result || item.status !== 'completed') {
            if (currentHistory.current.some((record) => record.id === item.id)) persistQueueRecord(item);
            return;
          }
          const result = item.result;
          if (shouldOpenCompletedResult(autoOpen.current, item) || currentSelection.current === item.id) {
            autoOpen.current = false; setShowScanner(false);
            setViewedVideos((current) => new Set(current).add(item.id));
            setFile(result.file); setActiveId(result.id); setRequest(result.request);
            setResultScenario(result.scenario); setHasResults(true); setView('results');
          }
          setHistory((items) => [result, ...items.filter((record) => record.id !== result.id)]);
          void saveAnalysis(result).catch(() => setHistoryError(true));
        }, (job) => { activeJob.current = job; });
    } finally {
      if (running.current === controller) { running.current = null; setQueueRunning(false); setShowScanner(false); setStage(null); }
    }
  };
  const restoreVideo = (id: string, replacement?: File) => {
    const item = batchRef.current.find((entry) => entry.id === id);
    if (!item || !['cancelled', 'failed'].includes(item.status) || (item.needsFile && !replacement)) return;
    const restored: BatchVideo = { ...item, file: replacement ?? item.file, needsFile: false, status: 'pending', result: undefined, error: undefined };
    setBatch((items) => items.map((entry) => entry.id === id ? restored : entry));
    persistQueueRecord(restored);
    void processBatch([]);
  };
  const deleteQueueVideo = (id: string) => {
    if (activeJob.current?.id === id) activeJob.current.controller.abort();
    setFiles((items) => items.filter((item) => item.id !== id));
    const remaining = batchRef.current.filter((item) => item.id !== id);
    setBatch(remaining);
    if (activeId === id) {
      const next = remaining.find((item) => item.result);
      if (next?.result) openHistory(next.result);
      else { setActiveId(remaining[0]?.id ?? null); setFile(null); setHasResults(false); }
    }
  };
  const start = () => {
    if (!files.length || running.current || !queueLoaded) return;
    autoOpen.current = true; setViewedVideos(new Set()); setHasResults(false);
    demoContext.current = { batchId: crypto.randomUUID(), request: request.trim(), scenario };
    const items: BatchVideo[] = files.map((upload) => ({ ...upload, batchId: demoContext.current.batchId, originalFilename: upload.file.name, createdAt: Date.now(), request: request.trim(), scenario, status: 'pending' }));
    setView('analysis'); setBatch(items); setActiveId(null); setFile(null);
    void processBatch(items, true);
  };
  const newAnalysis = () => {
    autoOpen.current = false; setShowScanner(false);
    setView('analysis');
    setFiles([]); setFile(null); setActiveId(null); setHasResults(false);
    if (!running.current) setBatch([]);
    setRequest('');
    setScenario('flagged');
    setResultScenario('flagged');
    // Remount the form to reset its file input, validation, and drag state.
    setUploadSession((session) => session + 1);
  };
  const openHistory = (record: AnalysisRecord) => {
    // Reconstruct the original saved batch without replacing any live queue jobs.
    const siblings = history.filter((entry) => record.batchId ? entry.batchId === record.batchId : entry.id === record.id);
    setBatch((items) => [...items, ...siblings.filter((entry) => !items.some((item) => item.id === entry.id)).map((entry): BatchVideo => ({
      ...entry, file: entry.file ?? new File([], entry.originalFilename ?? entry.displayName ?? 'video'),
      needsFile: entry.needsFile || !entry.file?.size,
      status: entry.status ?? 'completed',
      result: !entry.status || entry.status === 'completed' ? entry : undefined,
    }))]);
    autoOpen.current = false; setShowScanner(false);
    setViewedVideos((current) => new Set(current).add(record.id));
    if (record.status === 'cancelled') {
      const queued = batchRef.current.find((item) => item.id === record.id);
      if (!queued) setBatch((items) => [...items, { id: record.id, batchId: record.batchId, createdAt: record.createdAt, file: record.file ?? new File([], record.originalFilename ?? record.displayName ?? 'video'), displayName: record.displayName, originalFilename: record.originalFilename, needsFile: record.needsFile || !record.file?.size, request: record.request, scenario: record.scenario, status: 'cancelled' }]);
      setFile(null); setHasResults(false); setActiveId(record.id); setView('results');
      if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
      return;
    }
    if (record.status && record.status !== 'completed') return;
    setFile(record.file); setRequest(record.request); setScenario(record.scenario);
    setResultScenario(record.scenario); setActiveId(record.id); setHasResults(true); setView('results');
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  };
  const selectBatchVideo = (id: string) => {
    autoOpen.current = false; setShowScanner(false);
    const record = batch.find((item) => item.id === id)?.result;
    if (!record) {
      const item = batchRef.current.find((entry) => entry.id === id);
      if (item?.status === 'cancelled') { setActiveId(id); setFile(null); setHasResults(false); setView('results'); }
      return;
    }
    setViewedVideos((current) => new Set(current).add(record.id));
    setFile(record.file); setActiveId(record.id); setRequest(record.request); setResultScenario(record.scenario); setHasResults(true); setView('results');
  };
  const navigate = (nextView: View) => {
    if (nextView === 'results') {
      const latest = history.find((record) => !record.status || record.status === 'completed');
      if (latest) openHistory(latest); else if (batchRef.current.length) { setView('results'); setShowScanner(false); }
    } else {
      newAnalysis();
    }
  };
  const currentSelection = useRef(activeId);
  currentSelection.current = activeId;
  const currentHistory = useRef(history);
  currentHistory.current = history;
  const removeHistory = async (record: AnalysisRecord) => {
    // Commit storage first: failures must leave the visible entry and selection intact.
    await deleteAnalysis(record.id);
    deletedIds.current.add(record.id);
    if (activeJob.current?.id === record.id) activeJob.current.controller.abort();
    setHistory((items) => items.filter((item) => item.id !== record.id));
    setBatch((items) => items.filter((item) => item.id !== record.id));
    if (currentSelection.current === record.id) {
      const next = currentHistory.current.find((item) => item.id !== record.id);
      if (next) openHistory(next);
      else { setFile(null); setActiveId(null); setHasResults(false); setView('results'); }
    }
  };
  const activeRecord = history.find((item) => item.id === activeId);
  const selectedQueueItem = batch.find((item) => item.id === activeId);
  const cancellationItem = view === 'results' && activeRecord?.status === 'cancelled' ? selectedQueueItem : undefined;
  const batchId = activeRecord?.batchId ?? selectedQueueItem?.batchId ?? demoContext.current.batchId;
  const navigationItems = resultNavigationItems(batch, batchId, activeId ?? undefined);
  // Reopened batches also include completed records no longer present in the live queue.
  if (view === 'results' && activeRecord) {
    for (const record of history) {
      if ((record.status === undefined || record.status === 'completed' || record.status === 'cancelled') && (batchId ? record.batchId === batchId : record.id === activeId) && !navigationItems.some((item) => item.id === record.id)) navigationItems.push({ ...record, status: record.status ?? 'completed', result: !record.status || record.status === 'completed' ? record : undefined });
    }
  }
  const deleteCancelledHistory = async (id: string) => {
    const record = currentHistory.current.find((entry) => entry.id === id);
    if (record?.status === 'cancelled') await removeHistory(record);
    else deleteQueueVideo(id);
  };
  return <><Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)} /><div className="app-layout"><Navigation hidden={!sidebarOpen} view={view} onNavigate={navigate} hasResults={history.length > 0 || batch.length > 0} history={history} activeId={activeId} onOpenHistory={openHistory} onDeleteHistory={removeHistory} /><main>
    {historyError && <p className="error-message" role="alert">{t('historyError')}</p>}
    {view === 'results' && activeRecord && activeRecord.status !== 'cancelled' && <div className="history-summary"><h2>{t('savedAnalysis')}</h2><p>{new Date(activeRecord.createdAt).toLocaleString(language)}</p><p className="history-request"><strong>{t('analysisRequest')}: </strong>{activeRecord.request || t('defaultRequest')}</p><p>{t('scenario')}: {t(activeRecord.scenario === 'flagged' ? 'withEvents' : 'noEvents')}</p></div>}
    {!(showScanner && queueRunning) && batch.length > 0 && <VideoQueueNavigation items={navigationItems} cancellationItem={cancellationItem} showSingleTab={!!batchId && new Set([...batch.filter((item) => item.batchId === batchId).map((item) => item.id), ...history.filter((item) => item.batchId === batchId).map((item) => item.id)]).size > 1} activeId={activeId} viewed={viewedVideos} onOpen={selectBatchVideo} onCancel={cancelVideo} onRestore={restoreVideo} onDelete={deleteCancelledHistory} />}
    {showScanner && queueRunning ? <><ProcessingStatus stage={stage ?? 0} onCancel={cancelProcessing} /><VideoQueueNavigation items={navigationItems} cancellationItem={cancellationItem} showSingleTab={!!batchId && new Set([...batch.filter((item) => item.batchId === batchId).map((item) => item.id), ...history.filter((item) => item.batchId === batchId).map((item) => item.id)]).size > 1} activeId={activeId} viewed={viewedVideos} onOpen={selectBatchVideo} onCancel={cancelVideo} onRestore={restoreVideo} onDelete={deleteCancelledHistory} /></> : view === 'results' ? <>
      {!hasResults && !cancellationItem && <p className="history-empty">{t('emptyResultsHistory')}</p>}
      {hasResults && file && <ResultsView key={activeId ?? url} file={file} displayName={activeRecord?.displayName} url={url} scenario={resultScenario} onNew={newAnalysis} />}
    </> : <><VideoUpload key={uploadSession} request={request} onRequest={setRequest} files={files} onFiles={setFiles} onStart={start} busy={queueRunning || !queueLoaded} scenario={scenario} setScenario={setScenario} /></>}
  </main></div><Navigation mobile view={view} onNavigate={navigate} hasResults={history.length > 0 || batch.length > 0} /></>;
}

export default function App() { return <I18nProvider><Workspace /></I18nProvider>; }
