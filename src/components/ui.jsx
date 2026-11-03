import React, { useCallback, useEffect, useState } from 'react';
import { toneFor } from '../format.js';

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shifts: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2c2 .7 3.5 2.5 3.5 5.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 7 2 7 4s-2 4-7 4l7 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M2 21h20M8 8h2M8 12h2M8 16h2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.01"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  navigation: '<path d="m3 11 18-8-8 18-2-8-8-2z"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  power: '<path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  undo: '<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.7 2.7-2.3-.6-.6-2.3z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  utensils: '<path d="M6 3v8M9 3v8M6 7h3M7.5 11v10M17 3c-2 2-3 4.5-3 7h3v11"/>',
  paint: '<path d="M4 4h13v5H4zM17 6.5h3V12h-8v3M12 15v6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  leaf: '<path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15zM5 19c3-5 6-8 10-10"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
export const Icon = ({ name, size = 18 }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || ICONS.doc }} />
);

export const Pill = ({ children, tone }) => <span className={`pill ${tone || toneFor(children)}`}>{children}</span>;

export function PageIntro({ eyebrow, title, desc, action }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{desc}</p></div>{action}</div>;
}
export const Stat = ({ label, value, hint, tone = 'blue', icon = 'dashboard' }) => (
  <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon} /></div><div><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div></div>
);
export const Panel = ({ title, desc, right, children, className = '' }) => (
  <div className={`panel ${className}`}>{(title || right) && <div className="panel-head"><div>{title && <h2>{title}</h2>}{desc && <p>{desc}</p>}</div>{right}</div>}{children}</div>
);
export const Empty = ({ icon = 'doc', title, text }) => (
  <div className="empty"><div className="empty-icon"><Icon name={icon} size={24} /></div><b>{title}</b>{text && <p>{text}</p>}</div>
);
export const Spinner = () => <div className="loading"><span className="spinner" />Loading…</div>;
export const ErrorBox = ({ error, retry }) => (
  <div className="error-box"><Icon name="alert" /><div><b>Something went wrong</b><p>{error}</p></div>{retry && <button className="btn secondary mini" onClick={retry}>Retry</button>}</div>
);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

// Loads data on mount / when deps change.
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    set(s => ({ ...s, loading: true, error: null }));
    return fn().then(data => set({ data, error: null, loading: false }), e => set({ data: null, error: e.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Async({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorBox error={state.error} retry={state.reload} />;
  return children(state.data);
}

// Runs an action, shows success/error toast, then reloads.
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg, after) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); if (after) await after(r); return r; }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}
