import React, { useState } from 'react';
import { api } from '../api.js';
import { money, fmtDateTime } from '../format.js';
import { PageIntro, Panel, Pill, Stat, Empty, Async, useLoad, useAction } from '../components/ui.jsx';

export function AuditLogs({ toast }) {
  const [q, setQ] = useState('');
  const state = useLoad(() => api(`/admin/audit-logs?q=${encodeURIComponent(q)}&limit=200`), [q]);
  return <>
    <PageIntro eyebrow="SECURITY" title="Audit logs" desc="A record of sign-ins, approvals, file access and changes." />
    <Panel><div className="filters"><input placeholder="Search action, detail or person…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search audit logs" /></div>
      <Async state={state}>{({ logs }) => !logs.length ? <Empty icon="list" title="No entries" /> :
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th><th>IP</th></tr></thead><tbody>
          {logs.map(l => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{l.user_name || 'System'}{l.user_role && <span className="cell-sub">{l.user_role}</span>}</td><td><Pill tone="blue">{l.action}</Pill></td><td>{l.entity ? `${l.entity}${l.entity_id ? ' #' + l.entity_id : ''}` : '—'}</td><td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.detail || '—'}</td><td>{l.ip || '—'}</td></tr>)}</tbody></table></div>}</Async></Panel></>;
}

export function Reports() {
  const state = useLoad(() => api('/admin/reports'), []);
  return <>
    <PageIntro eyebrow="INSIGHTS" title="Reports" desc="Platform activity at a glance." />
    <Async state={state}>{r => { const max = Math.max(1, ...r.shifts_by_status.map(s => s.count)); return <>
      <div className="stats-grid three">
        <Stat label="Verified hours" value={r.totals.hours} hint="Approved + paid timesheets" icon="clock" />
        <Stat label="Payroll value" value={money(r.totals.amount)} hint="Approved + paid" tone="green" icon="rupee" />
        <Stat label="Shifts tracked" value={r.shifts_by_status.reduce((a, s) => a + s.count, 0)} tone="purple" icon="shifts" />
      </div>
      <div className="bottom-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Panel title="Shifts by status"><div className="bar-list">{r.shifts_by_status.map(s => <div className="bar-row" key={s.status}><span>{s.status}</span><div className="progress"><span style={{ width: (s.count / max) * 100 + '%' }} /></div><b>{s.count}</b></div>)}</div></Panel>
        <Panel title="Top businesses"><div className="table-wrap"><table><thead><tr><th>Company</th><th>Shifts</th><th>Positions</th></tr></thead><tbody>{r.top_businesses.map(b => <tr key={b.company}><td><b>{b.company}</b></td><td>{b.shifts}</td><td>{b.positions}</td></tr>)}</tbody></table></div></Panel>
        <Panel title="Top workers by earnings"><div className="table-wrap"><table><thead><tr><th>Worker</th><th>Shifts</th><th>Hours</th><th>Earned</th></tr></thead><tbody>{r.top_workers.map(w => <tr key={w.name}><td><b>{w.name}</b></td><td>{w.shifts}</td><td>{w.hours}</td><td>{money(w.earned)}</td></tr>)}</tbody></table></div></Panel>
        <Panel title="Payments by month"><div className="table-wrap"><table><thead><tr><th>Month</th><th>Count</th><th>Total</th></tr></thead><tbody>{r.payments_by_month.map(m => <tr key={m.month}><td>{m.month}</td><td>{m.count}</td><td>{money(m.total)}</td></tr>)}</tbody></table></div></Panel>
      </div></>; }}</Async></>;
}

export function Settings({ toast }) {
  const state = useLoad(() => api('/admin/settings'), []);
  return <><PageIntro eyebrow="CONFIGURATION" title="Settings" desc="Platform-wide business rules." />
    <Async state={state}>{({ settings }) => <SettingsForm initial={settings} toast={toast} />}</Async></>;
}
function SettingsForm({ initial, toast }) {
  const [f, setF] = useState(initial); const [run, busy] = useAction(toast);
  const save = e => { e.preventDefault(); run(() => api('/admin/settings', { method: 'PUT', body: f }), 'Settings saved.'); };
  return <Panel><form className="stack-form" style={{ maxWidth: 520 }} onSubmit={save}>
    <label className="field">Support email<input type="email" value={f.support_email} onChange={e => setF({ ...f, support_email: e.target.value })} /></label>
    <label className="field">Auto-approve timesheets after (hours) <span className="hint">0 disables auto-approval</span><input type="number" min="0" max="168" value={f.auto_approve_hours} onChange={e => setF({ ...f, auto_approve_hours: e.target.value })} /></label>
    <button className="btn primary" disabled={busy}>Save settings</button></form></Panel>;
}
