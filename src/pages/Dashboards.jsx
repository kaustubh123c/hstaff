import React from 'react';
import { api } from '../api.js';
import { money, fmtDate, shiftTime } from '../format.js';
import { Icon, PageIntro, Stat, Panel, Async, useLoad, Pill, Empty } from '../components/ui.jsx';
import { ShiftTable, ShiftCard } from './Shifts.jsx';
import { tr } from '../i18n.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function Dashboard({ user, go, language = 'en' }) {
  const state = useLoad(() => api('/dashboard'), [user.id]);
  return <Async state={state}>{d => user.role === 'business' ? <Business d={d} user={user} go={go} language={language} /> : user.role === 'worker' ? <Worker d={d} user={user} go={go} language={language} /> : <Admin d={d} go={go} />}</Async>;
}

function Business({ d, user, go, language }) {
  const t = key => tr(language, key);
  const s = d.stats, p = d.progress;
  return <>
    <section className="market-welcome user-welcome">
      <div><span className="market-kicker">{t('USER OVERVIEW')}</span><h2>{t(greeting())}, {user.name.split(' ')[0]}</h2><p>{t('Book trusted local help without the guesswork.')}</p></div>
      <button className="btn primary market-main-action" onClick={() => go('Nearby Jobs')}><Icon name="plus" size={17} />{t('Request nearby help')}</button>
    </section>
    <div className="stats-grid market-stats-grid">
      <Stat label={t('Active jobs')} value={s.active_shifts} hint={`${s.need_workers} ${t('need workers')}`} icon="shifts" />
      <Stat label={t('Workers engaged')} value={s.total_workers} hint={`${s.pending_applications} ${t('applications waiting')}`} tone="green" icon="users" />
      <Stat label={t('Pending timesheets')} value={s.pending_timesheets} hint={t('Needs review')} tone="orange" icon="clock" />
      <Stat label={t('Total payments')} value={money(s.total_payments)} hint={t('All time')} tone="purple" icon="rupee" />
    </div>
    <Panel className="market-main-panel" title={t('Recent jobs')} desc={t('Your latest work requests and scheduled jobs.')} right={<button className="text-btn" onClick={() => go('My Shifts')}>{t('View all')} →</button>}>
      {d.recent_shifts.length ? <ShiftTable shifts={d.recent_shifts} showBusiness={false} language={language} /> : <div className="market-empty"><Empty icon="shifts" title={t('No jobs yet')} text={t('Request nearby help to get started.')} /><button className="btn secondary mini" onClick={() => go('Nearby Jobs')}>{t('Request nearby help')}</button></div>}
    </Panel>
    <div className="bottom-grid">
      <Panel title={t('Request status')} right={<Pill tone="green">{t('Live overview')}</Pill>}>
        <div className="progress-row"><div><span>{t('Workers assigned')}</span><b>{p.filled} / {p.positions}</b></div><div className="progress"><span style={{ width: pct(p.filled, p.positions) + '%' }} /></div></div>
        <div className="progress-row"><div><span>{t('Timesheets approved')}</span><b>{p.timesheets_done} / {p.timesheets_total}</b></div><div className="progress"><span style={{ width: pct(p.timesheets_done, p.timesheets_total) + '%' }} /></div></div>
      </Panel>
      <Panel title={t('Quick actions')} className="quick-panel">
        <button onClick={() => go('Nearby Jobs')}><Icon name="plus" /> {t('Request nearby help')}</button>
        <button onClick={() => go('Nearby Jobs')}><Icon name="pin" /> {t('Track a job')}</button>
        <button onClick={() => go('Payments')}><Icon name="rupee" /> {t('View payments')}</button>
      </Panel>
    </div>
  </>;
}

function Worker({ d, user, go, language }) {
  const t = key => tr(language, key);
  const s = d.stats;
  return <>
    <section className="market-welcome worker-welcome">
      <div><span className="market-kicker">{t('WORKER OVERVIEW')}</span><h2>{t('Hi')}, {user.name.split(' ')[0]}</h2><p>{t('See nearby work, choose a shift, and track your earnings.')}</p></div>
      <button className="btn primary market-main-action" onClick={() => go('Nearby Jobs')}><Icon name="search" size={17} />{t('Find nearby jobs')}</button>
    </section>
    <div className="stats-grid market-stats-grid">
      <Stat label={t('Available shifts')} value={s.available_shifts} hint={t('Open right now')} icon="search" />
      <Stat label={t('My shifts')} value={s.my_shifts} hint={`${s.upcoming} ${t('confirmed')}`} tone="green" icon="shifts" />
      <Stat label={t('Completed shifts')} value={s.completed_shifts} hint={t('Approved timesheets')} tone="purple" icon="check" />
      <Stat label={t('Total earnings')} value={money(s.total_earnings)} hint={t('Approved + paid')} tone="orange" icon="rupee" />
    </div>
    <Panel className="market-main-panel" title={t('Recommended shifts')} desc={t('Open opportunities you have not applied to.')} right={<button className="text-btn" onClick={() => go('Find Shifts')}>{t('Find more')} →</button>}>
      {d.recommended.length ? <div className="worker-shift-list">{d.recommended.map(sh => <ShiftCard key={sh.id} shift={sh} language={language} action={<button className="btn primary mini" onClick={() => go('Find Shifts')}>{t('View details')}</button>} />)}</div>
        : <div className="market-empty"><Empty icon="search" title={t('Nothing new right now')} text={t('Check back soon — new shifts are posted every day.')} /><button className="btn secondary mini" onClick={() => go('Find Shifts')}>{t('Find more')}</button></div>}
    </Panel>
    <Panel className="info-banner">
      <div className="banner-symbol"><Icon name="doc" /></div>
      <div><b>{d.kyc_status === 'Verified' ? t('Your profile is verified') : t('Complete your KYC to apply for shifts')}</b>
        <p>{d.kyc_status === 'Verified' ? t('You can apply for any open shift.') : t('Upload an identity document. An admin will review it shortly.')}</p></div>
      {d.kyc_status !== 'Verified' ? <button className="btn secondary mini" style={{ marginLeft: 'auto' }} onClick={() => go('KYC Documents')}>{t(d.kyc_status)}</button> : <Pill tone="green">{t('Verified')}</Pill>}
    </Panel>
  </>;
}

function Admin({ d, go }) {
  const s = d.stats;
  const actions = [
    ['Users', 'Manage user accounts and access.', 'users'], ['Workers', 'Review worker profiles and status.', 'users'],
    ['KYC Verification', 'Review identity documents.', 'check'], ['Nearby Jobs', 'Monitor live marketplace requests.', 'pin'],
    ['Payments', 'Collections, payout queue and references.', 'rupee'], ['Disputes', 'Resolve complaints and reported issues.', 'flag'],
    ['Reports', 'Review platform activity and earnings.', 'chart'], ['Audit Logs', 'Inspect security and change history.', 'list'],
  ];
  return <>
    <div className="admin-dashboard">
      <PageIntro eyebrow="H-STAFF CONTROL CENTER" title="Platform overview" desc="A live view of workers, users, jobs, verification and money movement." />
      <div className="stats-grid admin-stat-grid">
        <Stat label="Workers" value={s.total_workers} hint="Registered worker profiles" icon="users" />
        <Stat label="Users" value={s.total_businesses} hint="Active marketplace accounts" tone="green" icon="user" />
        <Stat label="Active jobs" value={s.active_shifts} hint="Across the platform" tone="orange" icon="shifts" />
        <Stat label="KYC reviews" value={s.pending_kyc} hint="Waiting for admin review" tone="purple" icon="doc" />
        <Stat label="Open complaints" value={s.open_disputes} hint="Need an operations decision" tone="red" icon="flag" />
        <Stat label="Pending collection" value={money(s.pending_payments)} hint="Approved payment records" icon="rupee" />
      </div>
      <Panel className="admin-actions-panel" title="Operations" desc="Open a workspace to review and take action on platform activity.">
        <div className="admin-action-grid">{actions.map(([label, description, icon]) => <button className="admin-action-card" key={label} onClick={() => go(label)}>
          <span className="admin-action-icon"><Icon name={icon} /></span><span><b>{label}</b><small>{description}</small></span><span className="admin-action-arrow">→</span>
        </button>)}</div>
      </Panel>
      <Panel className="admin-recent-panel" title="Recent registrations" desc="Latest non-admin accounts" right={<button className="text-btn" onClick={() => go('Users')}>View user directory →</button>}>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Account type</th><th>Joined</th><th>Verification / status</th></tr></thead>
          <tbody>{d.recent_registrations.map(r => <tr key={r.id}><td><b>{r.name}</b></td><td>{r.role === 'business' ? 'User' : 'Worker'}</td><td>{fmtDate(r.created_at)}</td><td><Pill>{r.status}</Pill></td></tr>)}</tbody></table></div>
      </Panel>
    </div>
  </>;
}
