import { useEffect, useState } from 'react';
import { I18nProvider } from './i18n';
import { Header, Navigation, type View } from './components/Layout';
import { VideoUpload } from './components/VideoUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';

function Workspace() {
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
      else { setStage(null); setHasResults(true); setView('results'); }
    }, stage === 1 ? 1800 : 1000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const selectFile = (value: File | null) => { setFile(value); setHasResults(false); };
  const start = () => {
    if (!file) return;
    setResultScenario(scenario); setHasResults(false); setStage(0);
  };
  return <><Header /><div className="app-layout"><Navigation view={view} onNavigate={setView} hasResults={hasResults} /><main>
    {view === 'results' && hasResults && file ? <ResultsView file={file} url={url} scenario={resultScenario} onNew={() => { setView('analysis'); selectFile(null); }} /> : stage !== null ? <ProcessingStatus stage={stage} onCancel={() => setStage(null)} /> : <VideoUpload file={file} onFile={selectFile} onStart={start} scenario={scenario} setScenario={setScenario} />}
  </main></div><Navigation mobile view={view} onNavigate={setView} hasResults={hasResults} /></>;
}

export default function App() { return <I18nProvider><Workspace /></I18nProvider>; }
