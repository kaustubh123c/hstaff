import React, { useRef, useState } from 'react';
import { api, download } from '../api.js';
import { fmtDate, fmtDateTime } from '../format.js';
import { Icon, PageIntro, Panel, Pill, Empty, Async, useLoad, Modal, useAction } from '../components/ui.jsx';
import { tr } from '../i18n.js';

export function Workers({ user, toast }) {
  const state = useLoad(() => api('/workers'), [user.id]);
  const [run, busy] = useAction(toast);
  const [q, setQ] = useState('');
  const toggle = w => confirm(`${w.status === 'Active' ? 'Suspend' : 'Reactivate'} ${w.name}?`) && run(() => api(`/admin/users/${w.id}/status`, { method: 'POST', body: { status: w.status === 'Active' ? 'Suspended' : 'Active' } }), 'Account updated.', state.reload);
  return <>
    <PageIntro eyebrow="WORKER DIRECTORY" title="Workers" desc={user.role === 'admin' ? 'All registered workers and their verification status.' : 'Workers who have applied to or worked your shifts.'} />
    <Panel><div className="filters"><input placeholder="Search name, skill or area…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search workers" /></div>
      <Async state={state}>{({ workers }) => { const list = workers.filter(w => `${w.name} ${w.skills} ${w.location}`.toLowerCase().includes(q.toLowerCase()));
        return !list.length ? <Empty icon="users" title="No workers to show" /> :
        <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Skills</th><th>Location</th><th>Rating</th><th>KYC</th>{user.role === 'admin' && <><th>Phone</th><th>Account</th><th /></>}</tr></thead><tbody>
          {list.map(w => <tr key={w.id}><td><div className="person-cell"><div className="avatar">{w.name[0]}</div><b>{w.name}</b></div></td><td>{w.skills.replaceAll(',', ', ') || '—'}</td><td>{w.location || '—'}</td><td>{w.rating ? `★ ${w.rating}` : '—'}</td><td><Pill>{w.kyc_status}</Pill></td>
            {user.role === 'admin' && <><td>{w.phone || '—'}</td><td><Pill>{w.status}</Pill></td><td><button className="text-btn danger" disabled={busy} onClick={() => toggle(w)}>{w.status === 'Active' ? 'Suspend' : 'Reactivate'}</button></td></>}</tr>)}</tbody></table></div>; }}</Async></Panel>
  </>;
}

export function Businesses({ user, toast }) {
  const state = useLoad(() => api('/businesses'), [user.id]);
  const [run, busy] = useAction(toast);
  const toggle = b => confirm(`${b.status === 'Active' ? 'Suspend' : 'Reactivate'} ${b.company}?`) && run(() => api(`/admin/users/${b.id}/status`, { method: 'POST', body: { status: b.status === 'Active' ? 'Suspended' : 'Active' } }), 'Account updated.', state.reload);
  return <>
    <PageIntro eyebrow="ACCOUNT MANAGEMENT" title="Users" desc="Review user accounts, marketplace activity and account access." />
    <Panel className="admin-user-directory"><Async state={state}>{({ businesses }) => !businesses.length ? <Empty icon="users" title="No users yet" /> :
      <div className="table-wrap"><table><thead><tr><th>User</th><th>Contact</th><th>Email</th><th>Area</th><th>Jobs</th><th>Joined</th><th>Status</th><th>Access</th></tr></thead><tbody>
        {businesses.map(b => <tr key={b.id}><td><b>{b.company}</b></td><td>{b.name}</td><td>{b.email}</td><td>{b.address || '—'}</td><td>{b.shifts}</td><td>{fmtDate(b.created_at)}</td><td><Pill>{b.status}</Pill></td><td><button className="text-btn danger" disabled={busy} onClick={() => toggle(b)}>{b.status === 'Active' ? 'Suspend' : 'Reactivate'}</button></td></tr>)}</tbody></table></div>}</Async></Panel>
  </>;
}

// ---------------- KYC: worker ----------------
export function KycWorker({ user, toast, language = 'en' }) {
  const t = key => tr(language, key);
  const state = useLoad(() => api('/kyc/mine'), [user.id]);
  const [run, busy] = useAction(toast);
  const [type, setType] = useState('Identity document'); const file = useRef();
  const upload = e => {
    e.preventDefault(); const f = file.current.files[0]; if (!f) return toast('Choose a file first', 'error');
    const form = new FormData(); form.append('doc_type', type); form.append('file', f);
    run(() => api('/kyc', { method: 'POST', form }), 'Document uploaded for review.', () => { file.current.value = ''; state.reload(); });
  };
  const remove = d => confirm(t('Remove this document?')) && run(() => api(`/kyc/${d.id}`, { method: 'DELETE' }), t('Document removed.'), state.reload);
  return <>
    <PageIntro eyebrow={t('PROFILE VERIFICATION')} title={t('KYC documents')} desc={t('Upload documents so you can apply for shifts.')} />
    <Async state={state}>{({ documents, status, types }) => <div className="content-grid">
      <Panel title={t('Your documents')} right={<Pill>{t(status)}</Pill>}>
        {!documents.length ? <Empty icon="doc" title={t('No documents yet')} text={t('Upload an identity document to get verified.')} /> : documents.map(d => <div className="kyc-row" key={d.id}>
          <div className="doc-icon"><Icon name="doc" /></div><div><b>{t(d.doc_type)}</b><p className="muted">{d.original_name} · {(d.size / 1024).toFixed(0)} KB · {fmtDate(d.uploaded_at)}{d.review_note && <><br /><span style={{ color: 'var(--red)' }}>{t('Reviewer note')}: {d.review_note}</span></>}</p></div>
          <Pill>{t(d.status)}</Pill><button className="icon-btn" title={t('Download')} onClick={() => download(`/kyc/${d.id}/file`, d.original_name).catch(e => toast(e.message, 'error'))}><Icon name="download" size={16} /></button>
          {d.status !== 'Verified' && <button className="icon-btn" title={t('Remove')} disabled={busy} onClick={() => remove(d)}><Icon name="trash" size={16} /></button>}</div>)}</Panel>
      <Panel title={t('Upload a document')}><form className="stack-form" onSubmit={upload}>
        <label className="field">{t('Document type')}<select value={type} onChange={e => setType(e.target.value)}>{types.map(option => <option key={option}>{t(option)}</option>)}</select></label>
        <label className="field">{t('File')} <span className="hint">{t('PDF, JPG or PNG · max 5 MB')}</span><input ref={file} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label>
        <button className="btn primary" disabled={busy}><Icon name="upload" size={16} /> {t('Upload')}</button></form>
        <p className="footnote">{t('Files are stored privately and are only visible to you and platform admins.')}</p></Panel></div>}</Async></>;
}

// ---------------- KYC: admin ----------------
export function KycAdmin({ user, toast }) {
  const state = useLoad(() => api('/kyc'), [user.id]);
  const [run, busy] = useAction(toast);
  const [rej, setRej] = useState(null); const [note, setNote] = useState('');
  const approve = d => run(() => api(`/kyc/${d.id}/review`, { method: 'POST', body: { decision: 'approve' } }), `${d.worker_name} approved.`, state.reload);
  const reject = e => { e.preventDefault(); run(() => api(`/kyc/${rej.id}/review`, { method: 'POST', body: { decision: 'reject', note } }), 'Document rejected.', () => { setRej(null); setNote(''); state.reload(); }); };
  return <>
    <PageIntro eyebrow="OPERATIONS" title="KYC verification" desc="Review submissions. Every file view is recorded in the audit log." />
    <Panel><Async state={state}>{({ documents }) => !documents.length ? <Empty icon="doc" title="No submissions" /> :
      <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Document</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>
        {documents.map(d => <tr key={d.id}><td><b>{d.worker_name}</b></td><td>{d.doc_type}<span className="cell-sub">{d.original_name}</span></td><td>{fmtDate(d.uploaded_at)}</td><td><Pill>{d.status}</Pill>{d.review_note && <span className="cell-sub">{d.review_note}</span>}</td>
          <td><div className="action-pair"><button className="btn secondary mini" onClick={() => download(`/kyc/${d.id}/file`, d.original_name).catch(e => toast(e.message, 'error'))}>View file</button>
            {d.status !== 'Verified' && <button className="btn primary mini" disabled={busy} onClick={() => approve(d)}>Approve</button>}
            {d.status !== 'Rejected' && <button className="btn secondary mini" onClick={() => setRej(d)}>Reject</button>}</div></td></tr>)}</tbody></table></div>}</Async></Panel>
    {rej && <Modal title={`Reject ${rej.worker_name}'s document`} onClose={() => setRej(null)}><form className="stack-form" onSubmit={reject}>
      <label className="field">Reason <span className="hint">shown to the worker</span><textarea required rows="3" value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. Image is blurry — please upload a clearer copy" /></label>
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setRej(null)}>Cancel</button><button className="btn primary" disabled={busy}>Reject</button></div></form></Modal>}
  </>;
}

// ---------------- Profile ----------------
export function Profile({ user, toast, refreshUser, language = 'en' }) {
  const t = key => tr(language, key);
  const p = user.profile || {};
  const [f, setF] = useState({ name: user.name, phone: user.phone || '', company: p.company || '', address: p.address || '', skills: p.skills || '', location: p.location || '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [run, busy] = useAction(toast);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = e => { e.preventDefault(); const body = { name: f.name, phone: f.phone, ...(user.role === 'business' ? { company: f.company, address: f.address } : user.role === 'worker' ? { skills: f.skills, location: f.location } : {}) }; run(() => api('/auth/me', { method: 'PUT', body }), 'Profile saved.', refreshUser); };
  const change = e => { e.preventDefault(); run(() => api('/auth/change-password', { method: 'POST', body: pw }), 'Password changed.', () => setPw({ current: '', next: '' })); };
  return <>
    <PageIntro eyebrow={t('ACCOUNT')} title={t('Profile settings')} desc={t('Manage account details and contact information.')} />
    <div className="content-grid">
      <Panel title={t('Details')}><form className="shift-form" onSubmit={save}>
        <label className="field">{t('Full name')}<input required value={f.name} onChange={set('name')} /></label>
        <label className="field">{t('Phone')}<input value={f.phone} onChange={set('phone')} /></label>
        <label className="field wide">{t('Email')}<input value={user.email} disabled /></label>
        {user.role === 'business' && <><label className="field">{t('Company')}<input required value={f.company} onChange={set('company')} /></label><label className="field">{t('Address')}<input value={f.address} onChange={set('address')} /></label></>}
        {user.role === 'worker' && <><label className="field">{t('Skills')} <span className="hint">{t('comma separated')}</span><input value={f.skills} onChange={set('skills')} /></label><label className="field">{t('Area')}<input value={f.location} onChange={set('location')} /></label></>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>{t('Save changes')}</button></div></form></Panel>
      <Panel title={t('Change password')}><form className="stack-form" onSubmit={change}>
        <label className="field">{t('Current password')}<input type="password" required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
        <label className="field">{t('New password')} <span className="hint">{t('min. 8 characters')}</span><input type="password" required minLength={8} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
        <button className="btn secondary" disabled={busy}>{t('Update password')}</button></form>
        <p className="footnote">{t('Member since')} {fmtDate(user.created_at)} · {t('Role')}: {t(user.role)}</p></Panel></div></>;
}
