import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CircleX, AlertTriangle, CheckCircle2, Settings2, ChevronDown, FileCheck, Moon, PanelLeftClose, PanelLeftOpen, ScanLine, Sun } from 'lucide-react';
import { useI18n, type Language } from '../i18n';

import { historyViolationStatus, readHistoryPreferences, saveHistoryPreferences } from '../historyDisplay';
import { HistoryActions } from './HistoryActions';
import { groupHistory, type AnalysisRecord } from '../history';

export type View = 'analysis' | 'results';

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      try { if (localStorage.getItem('data-sentry-theme')) return; } catch { /* Storage may be unavailable. */ }
      const next = preference.matches ? 'dark' : 'light';
      setTheme(next);
      document.documentElement.dataset.theme = next;
    };
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('data-sentry-theme', next); } catch { /* Keep the in-memory preference. */ }
  };
  return <button className="icon-button" onClick={toggle} aria-label={t(theme === 'dark' ? 'lightTheme' : 'darkTheme')} title={t(theme === 'dark' ? 'lightTheme' : 'darkTheme')}>
    {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
  </button>;
}

function LanguageSelector() {
  const { language, setLanguage, t } = useI18n();
  const options: { value: Language; label: string }[] = [
    { value: 'kk', label: 'ҚАЗ' }, { value: 'ru', label: 'РУС' }, { value: 'en', label: 'ENG' },
  ];
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (open) items.current[focused]?.focus();
  }, [open, focused]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const show = () => { setFocused(options.findIndex((option) => option.value === language)); setOpen(true); };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const navigate = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setFocused((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
  };

  return <div ref={container} className="language-control" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="language-trigger" aria-label={`${t('language')}: ${options.find((option) => option.value === language)?.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
      {options.find((option) => option.value === language)?.label}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="language-menu" role="menu" aria-label={t('language')} onKeyDown={navigate}>
      {options.map((option, index) => <button key={option.value} ref={(element) => { items.current[index] = element; }} className="language-option" role="menuitemradio" aria-checked={language === option.value} tabIndex={-1}
        onFocus={() => setFocused(index)} onClick={() => { setLanguage(option.value); close(); }}>{option.label}</button>)}
    </div>}
  </div>;
}

export function Header({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const { t } = useI18n();
  return <header className="header">
    <div className="flex items-center gap-2"><button type="button" className="icon-button sidebar-toggle" onClick={onToggleSidebar} aria-expanded={sidebarOpen} aria-controls="sidebar-navigation" aria-label={t(sidebarOpen ? 'hideSidebar' : 'showSidebar')} title={t(sidebarOpen ? 'hideSidebar' : 'showSidebar')}>{sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}</button><div className="brand"><img src="/data-sentry.png" alt="" width="56" height="56" /><span>DATA <span className="font-normal">Sentry</span></span></div></div>
    <div className="flex items-center gap-2 sm:gap-4"><ThemeToggle /><span className="header-divider" /><LanguageSelector /></div>
  </header>;
}

export function Navigation({ view, onNavigate, hasResults, mobile = false, hidden = false, history = [], activeId, onOpenHistory, onDeleteHistory }: { view: View; onNavigate: (view: View) => void; hasResults: boolean; mobile?: boolean; hidden?: boolean; history?: AnalysisRecord[]; activeId?: string | null; onOpenHistory?: (record: AnalysisRecord) => void; onDeleteHistory?: (record: AnalysisRecord) => void | Promise<void> }) {
  const { t, language } = useI18n();
  const [preferences, setPreferences] = useState(() => {
    try { return readHistoryPreferences(localStorage); }
    catch { return { showStatusIcons: true, showBatchGrouping: true }; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsId = useId();
  useEffect(() => { try { saveHistoryPreferences(localStorage, preferences); } catch { /* Storage unavailable. */ } }, [preferences]);
  useEffect(() => {
    if (!settingsOpen) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !settings.current?.contains(event.target)) setSettingsOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [settingsOpen]);
  return <nav id={mobile ? undefined : 'sidebar-navigation'} hidden={hidden} className={mobile ? 'mobile-navigation' : 'sidebar'}>
    <button className={`nav-item ${view === 'analysis' ? 'is-active' : ''}`} onClick={() => onNavigate('analysis')} aria-current={view === 'analysis' ? 'page' : undefined}>
      <ScanLine size={20} /><span>{t(mobile ? 'analysisShort' : 'analysis')}</span>
    </button>
    <button className={`nav-item ${view === 'results' ? 'is-active' : ''}`} onClick={() => onNavigate('results')} disabled={!hasResults} aria-current={view === 'results' ? 'page' : undefined}>
      <FileCheck size={20} /><span>{t('results')}</span>
    </button>
    {!mobile && <section className="analysis-history" aria-label={t('history')}>
      <div className="history-heading"><h2>{t('history')}</h2><div ref={settings} className="history-settings" onKeyDown={(event) => { if (event.key === 'Escape' && settingsOpen) { event.stopPropagation(); setSettingsOpen(false); settingsButton.current?.focus(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSettingsOpen(false); }}>
        <button ref={settingsButton} type="button" className="icon-button history-settings-button" aria-label={t('historyDisplaySettings')} title={t('historyDisplaySettings')} aria-expanded={settingsOpen} aria-controls={settingsOpen ? settingsId : undefined} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={16} /></button>
        {settingsOpen && <div id={settingsId} className="history-settings-popover" role="group" aria-label={t('historyDisplaySettings')}>
          <label><span>{t('showHistoryIcons')}</span><input type="checkbox" role="switch" checked={preferences.showStatusIcons} onChange={(event) => setPreferences((current) => ({ ...current, showStatusIcons: event.target.checked }))} /></label>
          <label><span>{t('showHistoryGroups')}</span><input type="checkbox" role="switch" checked={preferences.showBatchGrouping} onChange={(event) => setPreferences((current) => ({ ...current, showBatchGrouping: event.target.checked }))} /></label>
        </div>}
      </div></div>
      {history.length === 0 && <p className="history-empty">{t('historyEmpty')}</p>}
      <div className="history-list">{groupHistory(history).map((group) => <div key={group.id} className={preferences.showBatchGrouping && group.records.length > 1 ? 'history-batch is-grouped' : 'history-batch'}>{group.records.map((record) => <div key={record.id} className={`history-row ${view === 'results' && activeId === record.id ? 'is-active' : ''}`}>
        <button className="history-open" onClick={() => onOpenHistory?.(record)} aria-current={view === 'results' && activeId === record.id ? 'true' : undefined} title={(record.displayName ?? record.file.name)}>
          <span className="history-filename">{preferences.showStatusIcons && record.status === 'cancelled' ? <span className="history-violation-icon cancelled" role="img" title={t('videoCancelled')} aria-label={t('videoCancelled')}><CircleX size={15} aria-hidden="true" /></span> : preferences.showStatusIcons && historyViolationStatus(record) && <span className={`history-violation-icon ${historyViolationStatus(record)}`} title={`${t('demo')} · ${t(historyViolationStatus(record) === 'flagged' ? 'historyFlagged' : 'historyClear')}`} role="img" aria-label={`${t('demo')} · ${t(historyViolationStatus(record) === 'flagged' ? 'historyFlagged' : 'historyClear')}`}>{historyViolationStatus(record) === 'flagged' ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}</span>}<span className="history-filename-text">{record.displayName ?? record.file.name}</span></span><small>{new Date(record.createdAt).toLocaleString(language, { dateStyle: 'short', timeStyle: 'short' })}</small>
        </button>
        <HistoryActions record={record} onDelete={() => onDeleteHistory?.(record)} />
      </div>)}</div>)}</div>
    </section>}
  </nav>;
}
