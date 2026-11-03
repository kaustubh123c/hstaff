import React, { useCallback, useEffect, useState } from 'react';
import { api, auth } from './api.js';
import { Icon, Spinner } from './components/ui.jsx';
import { fmtDateTime } from './format.js';
import AuthPage from './pages/Auth.jsx';
import Dashboard from './pages/Dashboards.jsx';
import ShiftsPage, { CreateShift } from './pages/Shifts.jsx';
import { Timesheets, Payments, Attendance, Disputes } from './pages/Work.jsx';
import { Workers, Businesses, KycWorker, KycAdmin, Profile } from './pages/People.jsx';
import { AuditLogs, Reports, Settings } from './pages/Admin.jsx';
import Marketplace from './pages/Marketplace.jsx';
import WorkerPortal from './pages/WorkerPortal.jsx';
import AdminMarketplace from './pages/AdminMarketplace.jsx';
import { tr } from './i18n.js';
import Notifications from './components/Notifications.jsx';

const MENUS = {
  business: ['Dashboard', 'Create Shift', 'Nearby Jobs', 'My Shifts', 'Workers', 'Timesheets', 'Payments', 'Disputes', 'Profile'],
  admin: ['Dashboard', 'Workers', 'Users', 'Shifts', 'Nearby Jobs', 'KYC Verification', 'Payments', 'Timesheets', 'Disputes', 'Audit Logs', 'Reports', 'Settings'],
};
const ICON = { Dashboard: 'dashboard', 'Create Shift': 'plus', 'Nearby Jobs': 'pin', 'My Shifts': 'shifts', Shifts: 'shifts', 'Find Shifts': 'search', Workers: 'users', Users: 'users', Businesses: 'building', Timesheets: 'clock', Payments: 'rupee', Profile: 'user', Attendance: 'qr', 'KYC Documents': 'doc', 'KYC Verification': 'check', Disputes: 'flag', 'Audit Logs': 'list', Reports: 'chart', Settings: 'settings' };

const pageFromHash = () => decodeURIComponent(location.hash.slice(1)) || 'Dashboard';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [page, setPage] = useState(pageFromHash);
  const [toasts, setToasts] = useState([]);
  const [nav, setNav] = useState(false);
  const [language,setLanguage]=useState(()=>localStorage.getItem('hstaff_language')||'en');

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'error' ? 6000 : 3800);
  }, []);
  const go = useCallback(p => { location.hash = encodeURIComponent(p); setPage(p); setNav(false); window.scrollTo(0, 0); }, []);
  const logout = useCallback(() => { auth.set(null); setUser(null); location.hash = ''; setPage('Dashboard'); }, []);
  const refreshUser = useCallback(() => api('/auth/me').then(r => setUser(r.user)), []);

  useEffect(() => {
    auth.onUnauthorized(() => { auth.set(null); setUser(null); });
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    api('/meta').then(setMeta).catch(() => setMeta({ demo: false }));
    if (auth.token) refreshUser().catch(() => setUser(null)); else setUser(null);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refreshUser]);

  if (user === undefined) return <div style={{ padding: 40 }}><Spinner /></div>;
  if (!user) return <AuthPage demo={meta?.demo} language={language} setLanguage={setLanguage} onAuth={(u, options) => { setUser(u); go(options?.showKyc || (u.role === 'worker' && u.profile?.kyc_status !== 'Verified') ? 'KYC Documents' : 'Dashboard'); }} />;

  // Workers get a deliberately tiny portal: their taken orders and personal info only.
  // Payments are tracked by the admin, so nothing about money is shown to workers.
  if (user.role === 'worker') return <>
    <WorkerPortal user={user} toast={toast} refreshUser={refreshUser} language={language} setLanguage={setLanguage} logout={logout} />
    <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}><Icon name={t.type === 'error' ? 'alert' : 'check'} size={16} />{t.message}</div>)}</div>
  </>;
  const menu = MENUS[user.role] || MENUS.business;
  const current = menu.includes(page) ? page : 'Dashboard';
  const display = user.role === 'business' ? user.profile?.company ?? user.name : user.name;
  const ctx = { user, toast, go, meta, page: current, refreshUser, language };
  const views = {
    Dashboard: <Dashboard {...ctx} />, 'Create Shift': <CreateShift {...ctx} />, 'My Shifts': <ShiftsPage {...ctx} />, 'Find Shifts': <ShiftsPage {...ctx} />, Shifts: <ShiftsPage {...ctx} />,
    Workers: <Workers {...ctx} />, Users: <Businesses {...ctx} />, Businesses: <Businesses {...ctx} />, Timesheets: <Timesheets {...ctx} />, Payments: <Payments {...ctx} />, Attendance: <Attendance {...ctx} />, 'Nearby Jobs': user.role === 'admin' ? <AdminMarketplace {...ctx} /> : <Marketplace {...ctx} />,
    'KYC Documents': <KycWorker {...ctx} />, 'KYC Verification': <KycAdmin {...ctx} />, Disputes: <Disputes {...ctx} />, 'Audit Logs': <AuditLogs {...ctx} />,
    Reports: <Reports {...ctx} />, Settings: <Settings {...ctx} />, Profile: <Profile {...ctx} />,
  };

  const marketShell = user.role === 'admin' ? '' : 'market-app-shell market-user-shell';
  return <div className={`app-shell ${user.role === 'admin' ? 'admin-app-shell' : ''} ${marketShell}`}>
    <div className={`scrim ${nav ? 'show' : ''}`} onClick={() => setNav(false)} />
    <aside className={`sidebar ${user.role === 'admin' ? 'admin-sidebar' : ''} ${nav ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark">H</span><div><b>H-Staff</b><small>{tr(language,'Hourly Staffing Platform')}</small></div></div>
      <div className="user-mini"><div className="avatar">{display[0]}</div><div><b>{display}</b><small>{user.role === 'business' ? tr(language, 'User') : user.role === 'admin' ? tr(language, 'Admin') : tr(language, 'Worker')} {tr(language, 'account')}</small></div></div>
      <nav>{menu.map(m => <button key={m} className={`nav-item ${current === m ? 'active' : ''}`} onClick={() => go(m)}><Icon name={ICON[m]} />{tr(language,m)}</button>)}</nav>
      <div className="sidebar-bottom">
        <button className="logout" onClick={logout}><Icon name="logout" />{tr(language,'Sign out')}</button>
        {meta?.demo && <div className="demo-tag"><span className="online-dot" />Demo mode · sample data</div>}
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn menu-btn" onClick={() => setNav(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div><span className="breadcrumb">H-Staff / {user.role === 'business' ? tr(language, 'User') : tr(language, user.role)}</span><h1>{tr(language,current)}</h1></div>
        </div>
        <div className="top-actions">{user.role === 'business'&&<select className="language-select" aria-label={tr(language,'Language')} value={language} onChange={e=>{setLanguage(e.target.value);localStorage.setItem('hstaff_language',e.target.value);}}><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select>}<Notifications language={language} />
          <div className="top-user"><div className="avatar small">{display[0]}</div><span>{display}</span></div></div>
      </header>
      <div key={current + user.id}>{views[current]}</div>
    </main>
    <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}><Icon name={t.type === 'error' ? 'alert' : 'check'} size={16} />{t.message}</div>)}</div>
  </div>;
}
