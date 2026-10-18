import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Trash2 } from 'lucide-react';
import type { AnalysisRecord } from '../history';
import { useI18n } from '../i18n';

export function HistoryActions({ record, onDelete }: { record: AnalysisRecord; onDelete: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const confirmationId = useId();
  const messageId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const filename = record.displayName ?? record.file.name;
  const close = () => { setPosition(null); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null); };
    const dismiss = () => setPosition(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className="icon-button history-actions-trigger" aria-label={`${t('historyActions')}: ${filename}`} title={t('historyActions')} aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? menuId : undefined} onClick={() => {
      if (position) { close(); return; }
      const rect = trigger.current!.getBoundingClientRect();
      setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 110)), left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)) });
    }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); trigger.current?.click(); } }}><Ellipsis size={17} /></button>
    {position && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={t('historyActions')} className="history-actions-menu" style={position} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null); }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}><button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => { close(); setDeleteError(false); confirmation.current?.showModal(); }}><Trash2 size={15} />{t('deleteAnalysis')}</button></div>, document.body)}
    <dialog ref={confirmation} className="duplicate-dialog" aria-labelledby={confirmationId} aria-describedby={messageId} onCancel={(event) => { if (deleting) event.preventDefault(); }} onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <h2 id={confirmationId}>{t('confirmDeleteTitle')}</h2><p id={messageId} className="delete-confirm-message">{t('confirmDeleteMessage')}</p>
      {deleteError && <p className="error-message" role="alert">{t('deleteFailed')}</p>}
      <div className="duplicate-actions"><button type="button" autoFocus disabled={deleting} className="button button-secondary" onClick={() => confirmation.current?.close()}>{t('cancelDelete')}</button><button type="button" disabled={deleting} className="button button-primary" onClick={async () => { setDeleting(true); setDeleteError(false); try { await onDelete(); confirmation.current?.close(); } catch { setDeleteError(true); } finally { setDeleting(false); } }}>{t('confirmDeleteAction')}</button></div>
    </dialog>
  </>;
}
