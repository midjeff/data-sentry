import { LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { JobSummary } from '../api';
import { useI18n } from '../i18n';
import { HistoryActions } from './HistoryActions';

type Props = { items: JobSummary[]; activeId: string | null; viewed: Set<string>; onOpen: (id: string) => void; onAction: (id: string, action: 'cancel' | 'restore') => Promise<void>; onDelete: (job: JobSummary) => Promise<void> };
export function BatchNavigation({ items, activeId, viewed, onOpen, onAction, onDelete }: Props) {
  const { t } = useI18n();
  if (items.length < 2) return null;
  return <div className="results-content video-tabs" role="group" aria-label={t('selectResultVideo')}>
    {items.map(item => <div key={item.id} className={`video-tab-item ${item.status === 'cancelled' ? 'is-cancelled' : ''}`}>
      <button className={`button button-secondary ${activeId === item.id ? 'is-selected' : ''}`} disabled={item.status === 'processing'} aria-pressed={activeId === item.id} onClick={() => onOpen(item.id)} title={item.filename}>
        <span className="video-tab-name">{item.filename}</span>
        {item.status === 'processing' && <span className="video-tab-status">{item.stage !== 'queued' && <LoaderCircle size={12} className="spinner" />}{t(item.stage === 'queued' ? 'queueWaiting' : 'scannerInProgress')}</span>}
        {item.status === 'cancelled' && <span className="video-tab-status">{t('videoCancelled')}</span>}
        {item.status === 'failed' && <span className="video-tab-status">{t('queueFailed')}</span>}
        {item.status === 'done' && !viewed.has(item.id) && <span className="video-tab-status video-tab-ready">{t('queueReady')}</span>}
      </button>
      {item.status === 'processing' ? <button className="icon-button" aria-label={`${t('cancel')}: ${item.filename}`} onClick={() => void onAction(item.id, 'cancel')}><X size={14} /></button> : <>
        {['failed', 'cancelled'].includes(item.status) && <button className="icon-button queue-restore queue-restore-icon" aria-label={t('restoreVideo')} title={t('restoreVideo')} onClick={() => void onAction(item.id, 'restore')}><RotateCcw size={14} /></button>}
        <HistoryActions record={item} onDelete={() => onDelete(item)} />
      </>}
    </div>)}
  </div>;
}
