import { Check, Circle, FileCheck, LoaderCircle, ScanLine, UploadCloud } from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n';
import { DemoNotice } from './VideoUpload';

export function ProcessingStatus({ stage, onCancel }: { stage: number; onCancel: () => void }) {
  const { t } = useI18n();
  const stages = [{ label: 'upload', Icon: UploadCloud }, { label: 'analysisShort', Icon: ScanLine }, { label: 'results', Icon: FileCheck }] as const;
  const captions: MessageKey[] = ['stageUpload', 'stageAnalysis', 'stageResults'];
  return <section className="upload-content"><div className="page-heading"><h1>{t('processingTitle')}</h1><p>{t('processingSubtitle')}</p></div><div className="processing-card">
    <div className="processing-symbol"><ScanLine size={30} strokeWidth={1.5} /></div>
    <p className="processing-caption" role="status">{t(captions[stage])}</p>
    <ol className="processing-steps">{stages.map(({ label, Icon }, index) => <li key={label} className={stage === index ? 'current' : stage > index ? 'complete' : ''} aria-current={stage === index ? 'step' : undefined}>
      <div className="step-icon">{stage > index ? <Check size={19} /> : <Icon size={19} />}</div><span>{t(label)}</span><span className="stage-state">{stage > index ? <Check size={12} /> : stage === index ? <LoaderCircle size={12} className="spinner" /> : <Circle size={9} />}{t(stage > index ? 'completed' : stage === index ? 'active' : 'pending')}</span>
    </li>)}</ol><button className="button button-secondary" onClick={onCancel}>{t('cancel')}</button>
    </div><DemoNotice /></section>;
}
