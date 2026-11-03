import React, { useState } from 'react';
import { api } from '../api.js';
import { money, fmtDate, shiftTime } from '../format.js';
import { Icon, PageIntro, Panel, Pill, Empty, Async, useLoad, Modal, useAction } from '../components/ui.jsx';
import { tr } from '../i18n.js';

export function ShiftTable({ shifts, showBusiness = true, onManage, language = 'en' }) {
  const t = key => tr(language, key);
  return <div className="table-wrap"><table>
    <thead><tr><th>{t('Shift ID')}</th><th>{t('Role')}</th>{showBusiness && <th>{t('Business')}</th>}<th>{t('Date & time')}</th><th>{t('Location')}</th><th>{t('Workers')}</th><th>{t('Rate')}</th><th>{t('Status')}</th>{onManage && <th />}</tr></thead>
    <tbody>{shifts.map(s => <tr key={s.id}>
      <td className="id-cell">{s.code}</td><td><b>{s.title}</b></td>{showBusiness && <td>{s.business}</td>}
      <td>{fmtDate(s.date)}<span className="cell-sub">{shiftTime(s)}</span></td><td>{s.location}</td>
      <td>{s.workers_filled} / {s.workers_needed}{s.pending_applications > 0 && <span className="cell-sub" style={{ color: 'var(--amber)' }}>{s.pending_applications} {t('new applicants')}</span>}</td>
      <td>{money(s.rate)}/hr</td><td><Pill>{t(s.status)}</Pill></td>
      {onManage && <td><button className="btn secondary mini" onClick={() => onManage(s)}>{t('Manage')}</button></td>}
    </tr>)}</tbody></table></div>;
}

export function ShiftCard({ shift: s, action, language = 'en' }) {
  const t = key => tr(language, key);
  return <div className="worker-shift">
    <div className="job-symbol"><Icon name="shifts" /></div>
    <div className="job-info"><b>{s.title}</b><span>{s.business} · {s.location}</span>
      <small>{fmtDate(s.date)} · {shiftTime(s)} · {s.workers_filled}/{s.workers_needed} {t('filled')}</small>
      {s.skills.length > 0 && <div className="skill-tags">{s.skills.map(k => <span key={k}>{k}</span>)}</div>}</div>
    <strong className="rate">{money(s.rate)}<small>/hr</small></strong>{action}
  </div>;
}

export default function ShiftsPage({ user, page, toast, go, language = 'en' }) {
  const t = key => tr(language, key);
  const mine = page === 'My Shifts' && user.role === 'worker';
  const [q, setQ] = useState(''); const [status, setStatus] = useState('All');
  const [manage, setManage] = useState(null);
  const state = useLoad(() => api(`/shifts?${mine ? 'scope=mine&' : ''}q=${encodeURIComponent(q)}&status=${status}`), [q, status, page, user.id]);
  const [run, busy] = useAction(toast);
  const isWorker = user.role === 'worker';
  const title = t(isWorker ? (mine ? 'My shifts' : 'Find suitable shifts') : user.role === 'business' ? 'My shifts' : 'All shifts');

  const apply = s => run(() => api(`/shifts/${s.id}/apply`, { method: 'POST' }), `Applied for ${s.code}. The business will review your application.`, state.reload);
  const withdraw = s => run(() => api(`/shifts/${s.id}/apply`, { method: 'DELETE' }), 'Application withdrawn.', state.reload);

  return <>
    <PageIntro eyebrow={t('SHIFT MANAGEMENT')} title={title}
      desc={t(isWorker ? (mine ? 'Shifts you have applied for or been assigned.' : 'Explore available hourly work opportunities.') : 'Review shift requirements, staffing capacity and status.')}
      action={user.role === 'business' && <button className="btn primary" onClick={() => go('Create Shift')}><Icon name="plus" size={16} /> {t('Create shift')}</button>} />
    <Panel>
      <div className="filters">
        <input placeholder={t('Search role, business or location…')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('Search shifts')} />
        {!(isWorker && !mine) && <select value={status} onChange={e => setStatus(e.target.value)} aria-label={t('Filter by status')}>{['All', 'Open', 'Filled', 'Ongoing', 'Completed', 'Cancelled'].map(o => <option key={o}>{t(o)}</option>)}</select>}
        <span className="muted">{state.data ? `${state.data.shifts.length} ${t('shifts')}` : ''}</span>
      </div>
      <Async state={state}>{({ shifts }) => !shifts.length ? <Empty icon="shifts" title={t('No shifts found')} text={t(isWorker && !mine ? 'Try a different search, or check back soon.' : 'Nothing matches your filters.')} />
        : isWorker ? <div className="worker-shift-list">{shifts.map(s => <ShiftCard key={s.id} shift={s} language={language} action={
          s.my_application && s.my_application.status !== 'Withdrawn'
            ? <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}><Pill>{t(s.my_application.status)}</Pill>{['Applied', 'Accepted'].includes(s.my_application.status) && ['Open', 'Filled'].includes(s.status) && <button className="text-btn danger" disabled={busy} onClick={() => withdraw(s)}>{t('Withdraw')}</button>}</div>
            : <button className="btn primary mini" disabled={busy} onClick={() => apply(s)}>{t('Apply')}</button>} />)}</div>
        : <ShiftTable shifts={shifts} language={language} showBusiness={user.role === 'admin'} onManage={setManage} />}</Async>
    </Panel>
    {manage && <ManageModal shift={manage} user={user} toast={toast} language={language} onClose={() => setManage(null)} onChanged={() => { state.reload(); }} go={go} />}
  </>;
}

function ManageModal({ shift, user, toast, language = 'en', onClose, onChanged, go }) {
  const t = key => tr(language, key);
  const [tab, setTab] = useState('applicants');
  const [s, setS] = useState(shift);
  const apps = useLoad(() => api(`/shifts/${shift.id}/applications`), [shift.id]);
  const qr = useLoad(() => ['Cancelled', 'Completed'].includes(s.status) ? Promise.resolve(null) : api(`/shifts/${shift.id}/qr`), [shift.id, s.status]);
  const [run, busy] = useAction(toast);
  const refresh = async () => { const r = await api(`/shifts/${shift.id}`); setS(r.shift); apps.reload(); onChanged(); };
  const decide = (a, decision) => run(() => api(`/applications/${a.id}/decision`, { method: 'POST', body: { decision } }), decision === 'accept' ? 'Worker accepted.' : 'Application declined.', refresh);
  const act = (kind, msg) => confirm(`${kind === 'cancel' ? 'Cancel' : 'Complete'} this shift?`) && run(() => api(`/shifts/${shift.id}/${kind}`, { method: 'POST' }), msg, refresh);
  const closed = ['Cancelled', 'Completed'].includes(s.status);

  return <Modal wide title={`${s.code} · ${s.title}`} onClose={onClose}>
    <p className="muted" style={{ marginTop: -8 }}>{fmtDate(s.date)} · {shiftTime(s)} · {s.location} · <Pill>{t(s.status)}</Pill> · {s.workers_filled}/{s.workers_needed} {t('filled')}</p>
    <div className="tabs">{[['applicants', 'Applicants'], ['qr', 'Attendance QR'], ['details', 'Details']].map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{t(l)}</button>)}</div>
    {tab === 'applicants' && <Async state={apps}>{({ applications }) => !applications.length ? <Empty icon="users" title={t('No applicants yet')} text={t('Workers will appear here when they apply.')} /> :
      <div className="table-wrap"><table><thead><tr><th>{t('Worker')}</th><th>{t('Skills')}</th><th>{t('Rating')}</th><th>KYC</th><th>{t('Status')}</th><th /></tr></thead><tbody>
        {applications.map(a => <tr key={a.id}><td><b>{a.name}</b><span className="cell-sub">{a.location}</span></td><td>{a.skills.replaceAll(',', ', ')}</td><td>★ {a.rating || '—'}</td><td><Pill>{a.kyc_status}</Pill></td><td><Pill>{a.status}</Pill></td>
          <td>{!closed && <div className="action-pair">
            {a.status !== 'Accepted' && <button className="btn primary mini" disabled={busy} onClick={() => decide(a, 'accept')}>{t('Accept')}</button>}
            {a.status !== 'Rejected' && <button className="btn secondary mini" disabled={busy} onClick={() => decide(a, 'reject')}>{t(a.status === 'Accepted' ? 'Remove' : 'Decline')}</button>}</div>}</td></tr>)}</tbody></table></div>}</Async>}
    {tab === 'qr' && <Async state={qr}>{d => !d ? <Empty icon="qr" title={t('QR not available')} text={t('This shift is closed.')} /> : <div style={{ textAlign: 'center' }}>
      <div className="qr-box" dangerouslySetInnerHTML={{ __html: d.svg }} />
      <p className="muted">Display this code at the work site. Accepted workers scan it from Attendance — the server verifies the signature, 12-hour post-shift expiry, assignment, shift time and live GPS geofence.</p>
      <div className="token">{d.token}</div>
      <div className="modal-actions" style={{ justifyContent: 'center' }}><button className="btn secondary mini" onClick={() => navigator.clipboard?.writeText(d.token).then(() => toast(t('Code copied')))}>{t('Copy code')}</button></div></div>}</Async>}
    {tab === 'details' && <dl className="kv">
      <dt>Description</dt><dd>{s.description || '—'}</dd><dt>Skills</dt><dd>{s.skills.join(', ') || '—'}</dd><dt>Rate</dt><dd>{money(s.rate)} / hour</dd>
      <dt>Geofence</dt><dd>{s.lat != null ? `${s.radius_m} m around ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : 'No location pin set (GPS not enforced)'}</dd></dl>}
    <div className="modal-actions">
      {!closed && <button className="btn danger" disabled={busy} onClick={() => act('cancel', 'Shift cancelled.')}>{t('Cancel shift')}</button>}
      {['Filled', 'Ongoing'].includes(s.status) && <button className="btn primary" disabled={busy} onClick={() => act('complete', 'Shift completed. Timesheets were generated.')}>{t('Mark completed')}</button>}
      <button className="btn secondary" onClick={onClose}>{t('Close')}</button>
    </div>
  </Modal>;
}

// ---- Create shift ----------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
export function CreateShift({ toast, go, language = 'en' }) {
  const t = key => tr(language, key);
  const [f, setF] = useState({ title: '', description: '', location: '', lat: '', lng: '', radius_m: 200, date: today(), start_time: '09:00', end_time: '17:00', workers_needed: 1, rate: 150 });
  const [skills, setSkills] = useState([]); const [skillInput, setSkillInput] = useState('');
  const [run, busy] = useAction(toast);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const addSkill = () => { const v = skillInput.trim(); if (v && !skills.includes(v) && skills.length < 10) setSkills([...skills, v]); setSkillInput(''); };
  const here = () => navigator.geolocation?.getCurrentPosition(
    p => setF(x => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })),
    () => toast('Could not read your location. Allow access or type coordinates.', 'error'));
  const submit = e => {
    e.preventDefault();
    const body = { ...f, skills, lat: f.lat === '' ? null : f.lat, lng: f.lng === '' ? null : f.lng };
    run(() => api('/shifts', { method: 'POST', body }), 'Shift created and open for applications.', () => go('My Shifts'));
  };
  return <>
    <PageIntro eyebrow={t('NEW REQUIREMENT')} title={t('Create a new shift')} desc={t('Enter the staffing requirement for your business.')} />
    <section className="content-grid">
      <Panel><form className="shift-form" onSubmit={submit}>
        <label className="field">{t('Job title')}<input required placeholder={t('e.g. Cleaner, Helper, Security')} value={f.title} onChange={set('title')} maxLength={80} /></label>
        <label className="field">{t('Hourly rate (₹)')}<input type="number" min="1" required value={f.rate} onChange={set('rate')} /></label>
        <label className="field wide">{t('Description')}<textarea rows="3" placeholder={t('Describe responsibilities and any requirements')} value={f.description} onChange={set('description')} maxLength={1000} /></label>
        <label className="field">{t('Required workers')}<input type="number" min="1" max="100" required value={f.workers_needed} onChange={set('workers_needed')} /></label>
        <label className="field">{t('Shift date')}<input type="date" required min={today()} value={f.date} onChange={set('date')} /></label>
        <label className="field">{t('Start time')}<input type="time" required value={f.start_time} onChange={set('start_time')} /></label>
        <label className="field">{t('End time')}<input type="time" required value={f.end_time} onChange={set('end_time')} /><span className="hint">{t('If earlier than start, the shift ends the next day.')}</span></label>
        <div className="field wide">{t('Required skills')}
          <div className="chips">{skills.map(k => <span className="chip" key={k}>{k}<button type="button" aria-label={`Remove ${k}`} onClick={() => setSkills(skills.filter(x => x !== k))}>×</button></span>)}
            <input placeholder="Type a skill and press Enter" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkill(); } }} onBlur={addSkill} /></div></div>
        <label className="field wide">{t('Work location')}<input required placeholder={t('e.g. Hinjawadi, Pune')} value={f.location} onChange={set('location')} /></label>
        <label className="field">{t('Latitude')} <span className="hint">{t('for GPS check')}</span><input type="number" step="any" value={f.lat} onChange={set('lat')} /></label>
        <label className="field">{t('Longitude')}<input type="number" step="any" value={f.lng} onChange={set('lng')} /></label>
        <label className="field">{t('Geofence radius (m)')}<input type="number" min="25" max="5000" value={f.radius_m} onChange={set('radius_m')} /></label>
        <div className="field" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn secondary" onClick={here}><Icon name="pin" size={16} /> {t('Use my current location')}</button></div>
        <div className="form-actions"><button type="button" className="btn secondary" onClick={() => go('Dashboard')}>{t('Cancel')}</button><button className="btn primary" disabled={busy}>{busy ? t('Creating…') : t('Create shift')}</button></div>
      </form></Panel>
      <Panel className="side-note"><h3>{t('Before publishing')}</h3><p className="muted">{t('Make sure the shift details are correct so workers can decide whether to apply.')}</p>
        <ul className="check-list">{['Confirm required worker capacity', 'Set an agreed hourly rate', 'Add the correct work location', 'Check date and shift timings'].map(t => <li key={t}><Icon name="check" size={16} />{t}</li>)}</ul>
        <div className="info-box"><b>GPS attendance</b><p>Set both latitude and longitude to enable attendance QR generation. Workers must be inside this radius when clocking in and out.</p></div></Panel>
    </section>
  </>;
}
