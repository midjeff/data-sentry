import { useId } from 'react';
import { Cctv, LoaderCircle } from 'lucide-react';
import { stageMessageKey, useI18n } from '../i18n';
function SurveillanceCamera() {
  const id = useId();
  return <svg className="scanner-camera" viewBox="0 0 640 350" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-beam`} x1="320" y1="155" x2="320" y2="310" gradientUnits="userSpaceOnUse"><stop stopColor="#df8eb5" stopOpacity=".2" /><stop offset="1" stopColor="#df8eb5" stopOpacity=".015" /></linearGradient>
      <radialGradient id={`${id}-lens`}><stop stopColor="#eea1c5" stopOpacity=".3" /><stop offset="1" stopColor="#eea1c5" stopOpacity="0" /></radialGradient>
    </defs>
    <g className="scanner-detection" stroke="currentColor" strokeWidth="2"><path d="M139 91h91m190 14h91" strokeDasharray="6 9" /><circle cx="139" cy="91" r="4" fill="currentColor" /><circle cx="511" cy="105" r="3" fill="currentColor" /><path d="M137 250v-46h49m267 0h49v46" opacity=".65" /></g>
    <path d="M125 301h390" stroke="currentColor" strokeWidth="2.5" strokeDasharray="8 11" opacity=".55" />
    <g className="scanner-sweep">
      <path d="M320 150 125 300h390Z" fill={`url(#${id}-beam)`} />
      <g transform="rotate(-16 320 156)">
        <rect x="225" y="96" width="194" height="91" rx="18" fill="#27232e" stroke="currentColor" strokeWidth="3.5" />
        <circle cx="338" cy="142" r="56" fill={`url(#${id}-lens)`} className="scanner-lens-glow" />
        <circle cx="338" cy="142" r="40" fill="#14121e" stroke="currentColor" strokeWidth="6" />
        <circle cx="338" cy="142" r="24" fill="#443044" />
        <circle className="scanner-lens" cx="338" cy="142" r="11" fill="#eda0c4" />
      </g>
    </g>
    <g stroke="currentColor" strokeWidth="9" strokeLinecap="round"><path d="m278 218 17 29h76l22-35" /><path d="M332 247v27m-55 0h110" /></g>
  </svg>;
}

export function ProcessingStatus({ stage, internalStage, isDemo = false, onBack, onCancel }: {
  stage: 0 | 1; internalStage?: string; isDemo?: boolean; onBack?: () => void; onCancel?: () => void;
}) {
  const { t } = useI18n();
  const stageKey = internalStage ? stageMessageKey(internalStage) : undefined;
  return <section className="scanner-loading"><div className="scanner-shell">
    <div className="scanner-heading"><h1><Cctv size={20} />DATA Sentry Scanner</h1>{isDemo && <span className="scanner-demo">{t('demo')}</span>}</div>
    <div className="scanner-screen"><SurveillanceCamera /><div className="scanner-status" role="status"><h2>{t('processingTitle')}</h2>
      <p className="scanner-simple-status"><LoaderCircle size={14} className="spinner" aria-hidden="true" /><span>{t(stage === 0 ? 'stageUpload' : 'stageAnalysis')}</span></p>
      {stageKey && <p className="helper-text">{t(stageKey)}</p>}
    </div></div>
    <div className="scanner-footer">{onBack && <button className="button button-secondary" onClick={onBack}>{t('backToUpload')}</button>}{onCancel && <button className="button button-secondary" onClick={onCancel}>{t('cancel')}</button>}</div>
  </div></section>;
}
