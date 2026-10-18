import { useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { BatchVideo } from '../batch';
import { useI18n } from '../i18n';
import { isSupportedVideo, VIDEO_ACCEPT } from '../videoFormats';

type Props = { items: BatchVideo[]; cancellationItem?: BatchVideo; showSingleTab?: boolean; activeId: string | null; viewed: Set<string>; onOpen: (id: string) => void; onCancel: (id: string) => void; onRestore: (id: string, file?: File) => void; onDelete: (id: string) => void | Promise<void> };
export function VideoQueueNavigation({ items, cancellationItem, showSingleTab = false, activeId, viewed, onOpen, onCancel, onRestore, onDelete }: Props) {
  const { t } = useI18n();
  const confirmation = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const selected = cancellationItem;
  const deleteIsCancelled = cancellationItem?.id === deleteId || items.some((item) => item.id === deleteId && item.status === 'cancelled');
  const restore = (item: BatchVideo) => {
    if (item.needsFile) { setReplacementId(item.id); input.current?.click(); }
    else onRestore(item.id);
  };
  const remove = (id: string) => { setDeleteId(id); setDeleteError(false); confirmation.current?.showModal(); };
  const actions = (item: BatchVideo, iconOnly = false) => <>
    <button type="button" className={iconOnly ? 'icon-button queue-restore queue-restore-icon' : 'button button-secondary details-toggle queue-restore'} title={iconOnly ? t('restoreVideo') : undefined} aria-label={iconOnly ? t('restoreVideo') : undefined} onClick={() => restore(item)}><RotateCcw size={13} />{!iconOnly && t('restoreVideo')}</button>
    <button type="button" className="icon-button queue-delete" aria-label={`${t('deleteQueueVideo')}: ${item.displayName ?? item.file.name}`} onClick={() => remove(item.id)}><Trash2 size={14} /></button>
  </>;
  return <section className="queue-navigation results-content">
    <input ref={input} type="file" accept={VIDEO_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t('reselectVideo')} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      const item = cancellationItem?.id === replacementId ? cancellationItem : items.find((entry) => entry.id === replacementId);
      if (file && item) {
        if (isSupportedVideo(file) && file.name === (item.originalFilename ?? item.file.name)) { setInvalid(false); onRestore(item.id, file); }
        else setInvalid(true);
      }
      event.currentTarget.value = '';
    }} />
    {(items.length > 1 || showSingleTab) && <div className="video-tabs" role="group" aria-label={t('selectResultVideo')}>
      {items.map((item) => <div key={item.id} className={`video-tab-item ${item.status === 'cancelled' ? 'is-cancelled' : ''}`}>
        <button className={`button button-secondary ${activeId === item.id ? 'is-selected' : ''}`} disabled={!['completed', 'cancelled'].includes(item.status)} aria-pressed={activeId === item.id} onClick={() => onOpen(item.id)} title={item.displayName ?? item.file.name}>
          <span className="video-tab-name">{item.displayName ?? item.file.name}</span>
          {item.status === 'processing' && <span className="video-tab-status"><LoaderCircle size={12} className="spinner" />{t('scannerInProgress')}</span>}
          {item.status === 'pending' && <span className="video-tab-status">{t('queueWaiting')}</span>}
          {item.status === 'cancelled' && <span className="video-tab-status">{t('videoCancelled')}</span>}
          {item.status === 'completed' && !viewed.has(item.id) && <span className="video-tab-status video-tab-ready">{t('queueReady')}</span>}
          {item.status === 'failed' && <span className="video-tab-status">{t('queueFailed')}</span>}
        </button>
        {['pending', 'processing'].includes(item.status) && <button type="button" className="icon-button" aria-label={`${t('cancel')}: ${item.displayName ?? item.file.name}`} onClick={() => onCancel(item.id)}><X size={14} /></button>}
        {['cancelled', 'failed'].includes(item.status) && actions(item, true)}
      </div>)}
    </div>}
    {selected?.status === 'cancelled' && <div className="panel cancelled-video-state"><p>{t('videoCancelledMessage')}</p>{selected.needsFile && <p className="helper-text">{t('reselectVideo')}</p>}<div className="cancelled-video-actions">{actions(selected)}</div></div>}
    {invalid && <p className="error-message" role="alert">{t('reselectVideoError')}</p>}
    <dialog ref={confirmation} className="duplicate-dialog" aria-label={t(deleteIsCancelled ? 'confirmDeleteTitle' : 'deleteQueueTitle')} onCancel={(event) => { if (deleting) event.preventDefault(); }}>
      <h2>{t(deleteIsCancelled ? 'confirmDeleteTitle' : 'deleteQueueTitle')}</h2><p className="delete-confirm-message">{t(deleteIsCancelled ? 'confirmDeleteMessage' : 'deleteQueueMessage')}</p>{deleteError && <p className="error-message" role="alert">{t('deleteFailed')}</p>}
      <div className="duplicate-actions"><button type="button" autoFocus disabled={deleting} className="button button-secondary" onClick={() => confirmation.current?.close()}>{t('cancelDelete')}</button><button type="button" disabled={deleting} className="button queue-delete-confirm" onClick={async () => { if (!deleteId) return; setDeleting(true); try { await onDelete(deleteId); confirmation.current?.close(); setDeleteId(null); } catch { setDeleteError(true); } finally { setDeleting(false); } }}>{t('confirmDeleteAction')}</button></div>
    </dialog>
  </section>;
}
