import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { Header, Navigation, type View } from './components/Layout';
import { VideoUpload } from './components/VideoUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';

import { readHistory, saveAnalysis, deleteAnalysis, type AnalysisRecord } from './history';

function Workspace() {
  const { t, language } = useI18n();
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let mounted = true;
    readHistory().then((items) => { if (mounted) setHistory(items.sort((a, b) => b.createdAt - a.createdAt)); }).catch(() => { if (mounted) setHistoryError(true); });
    return () => { mounted = false; };
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [view, setView] = useState<View>('analysis');
  const [file, setFile] = useState<File | null>(null);
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
    if (stage === null) return;
    const timer = window.setTimeout(() => {
      if (stage < 2) setStage(stage + 1);
      else {
        setStage(null); setHasResults(true); setView('results');
        if (file) {
          const record: AnalysisRecord = { id: crypto.randomUUID(), createdAt: Date.now(), file, request: request.trim(), scenario: resultScenario };
          setHistory((items) => [record, ...items]); setActiveId(record.id);
          void saveAnalysis(record).catch(() => setHistoryError(true));
        }
      }
    }, stage === 1 ? 1800 : 1000);
    return () => window.clearTimeout(timer);
  }, [stage, file, request, resultScenario]);

  const selectFile = (value: File | null) => { setFile(value); setHasResults(false); setActiveId(null); };
  const start = () => {
    if (!file) return;
    setResultScenario(scenario); setHasResults(false); setStage(0);
  };
  const newAnalysis = () => { setStage(null); setView('analysis'); selectFile(null); setRequest(''); };
  const openHistory = (record: AnalysisRecord) => {
    setStage(null); setFile(record.file); setRequest(record.request); setScenario(record.scenario);
    setResultScenario(record.scenario); setActiveId(record.id); setHasResults(true); setView('results');
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  };
  const navigate = (nextView: View) => {
    if (nextView === 'results') {
      const latest = history[0];
      if (latest) openHistory(latest);
    } else {
      setView('analysis');
    }
  };
  const removeHistory = async (record: AnalysisRecord) => {
    try {
      await deleteAnalysis(record.id);
      setHistory((items) => items.filter((item) => item.id !== record.id));
      if (activeId === record.id) newAnalysis();
    } catch { setHistoryError(true); }
  };
  const activeRecord = history.find((item) => item.id === activeId);
  return <><Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)} /><div className="app-layout"><Navigation hidden={!sidebarOpen} view={view} onNavigate={navigate} hasResults={history.length > 0} history={history} activeId={activeId} onOpenHistory={openHistory} onDeleteHistory={removeHistory} /><main>
    {historyError && <p className="error-message" role="alert">{t('historyError')}</p>}
    {view === 'results' && activeRecord && <div className="history-summary"><h2>{t('savedAnalysis')}</h2><p>{new Date(activeRecord.createdAt).toLocaleString(language)}</p><p className="history-request"><strong>{t('analysisRequest')}: </strong>{activeRecord.request || t('defaultRequest')}</p><p>{t('scenario')}: {t(activeRecord.scenario === 'flagged' ? 'withEvents' : 'noEvents')}</p></div>}
    {view === 'results' && hasResults && file ? <ResultsView key={activeId ?? url} file={file} url={url} scenario={resultScenario} onNew={newAnalysis} /> : stage !== null ? <ProcessingStatus stage={stage} onCancel={() => setStage(null)} /> : <VideoUpload request={request} onRequest={setRequest} file={file} onFile={selectFile} onStart={start} scenario={scenario} setScenario={setScenario} />}
  </main></div><Navigation mobile view={view} onNavigate={navigate} hasResults={history.length > 0} /></>;
}

export default function App() { return <I18nProvider><Workspace /></I18nProvider>; }
