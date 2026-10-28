import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Logo, safeStorage } from './kit';
import { PAGES, type Page } from './routes';

const paths: Record<Page, string> = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  play: 'M6 7h12c3 0 5 11 2 12-2 1-4-3-5-3H9c-1 0-3 4-5 3C1 18 3 7 6 7ZM7 9v6m-3-3h6m6-1h.01m3 3h.01',
  watch: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  tournament: 'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8',
  lab: 'M12 18V5a3 3 0 0 0-5-2 3 3 0 0 0-3 4 4 4 0 0 0-1 7 4 4 0 0 0 4 6 3 3 0 0 0 5-2Zm-5-8a3 3 0 0 1-3-3m4 8a3 3 0 0 0-4 1m12-12v5h5m-9 3h6v6m-6-2h3m6-13h.01m0 6h.01m-3 9h.01',
};

export function Sidebar({ page, onDrawerChange }: { page: Page; onDrawerChange: (open: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(() => safeStorage.get('local', 'nebulousai.sidebar.collapsed') === '1');
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const labels = { home: t.navigation.home, ...t.app.modes };

  useEffect(() => { setOpen(false); }, [page]);
  useEffect(() => { onDrawerChange(open); }, [open, onDrawerChange]);
  useEffect(() => {
    const media = matchMedia('(min-width: 1280px)');
    const close = () => { if (media.matches) setOpen(false); };
    media.addEventListener('change', close);
    return () => media.removeEventListener('change', close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('.drawer-close')?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); }
      // Keep game shortcuts from handling keystrokes while the navigation dialog is open.
      if (event.key !== 'Tab') { event.stopImmediatePropagation(); return; }
      const items = [...panel.current!.querySelectorAll<HTMLElement>('a, button')].filter((el) => el.tabIndex >= 0 && el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(focusFrame); window.removeEventListener('keydown', key, true); (previous ?? opener.current)?.focus(); };
  }, [open]);

  return <>
    <button ref={opener} className="mobile-menu" aria-label={t.navigation.open} aria-expanded={open} aria-controls="main-sidebar" onClick={() => setOpen(true)} data-testid="open-sidebar">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} data-testid="sidebar-backdrop" />}
    <aside ref={panel} id="main-sidebar" className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${open ? 'is-open' : ''}`} role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label={t.navigation.label} data-testid="sidebar"
      onTransitionEnd={(event) => { if (open && event.target === panel.current && event.propertyName === 'transform') panel.current?.querySelector<HTMLButtonElement>('.drawer-close')?.focus(); }}>
      <div className="sidebar-brand">
        <a href="#/home" aria-label={t.app.home} tabIndex={open ? -1 : undefined}><Logo size={32} /><span>Nebulous<span className="brand-ai">AI</span></span></a>
        <button className="drawer-close" aria-label={t.navigation.close} onClick={() => setOpen(false)}>×</button>
      </div>
      <button className="sidebar-toggle" aria-label={collapsed ? t.navigation.expand : t.navigation.collapse} aria-expanded={!collapsed} aria-controls="sidebar-links" title={collapsed ? t.navigation.expand : t.navigation.collapse} onClick={() => { setCollapsed(!collapsed); safeStorage.set('local', 'nebulousai.sidebar.collapsed', collapsed ? '0' : '1'); }} data-testid="toggle-sidebar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m5-11 3 3-3 3" /></svg><span>{t.navigation.collapse}</span>
      </button>
      <nav id="sidebar-links" aria-label={t.navigation.label}>
        {PAGES.map((item) => <a key={item} href={`#/${item}`} aria-label={labels[item]} aria-current={page === item ? 'page' : undefined} title={labels[item]} onClick={() => setOpen(false)} data-testid={`mode-${item}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[item]} /></svg><span>{labels[item]}</span>
        </a>)}
      </nav>
    </aside>
  </>;
}
