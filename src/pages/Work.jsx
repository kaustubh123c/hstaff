import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, shiftTime } from '../format.js';
import { Icon, PageIntro, Panel, Pill, Stat, Empty, Async, useLoad, Modal, useAction } from '../components/ui.jsx';
import { tr } from '../i18n.js';

// ---------------- Timesheets ----------------
export function Timesheets({ user, toast, language = 'en' }) {
  const t = key => tr(language, key);
  const state = useLoad(() => api('/timesheets'), [user.id]);
  const [run, busy] = useAction(toast);
  const [dispute, setDispute] = useState(null); const [reason, setReason] = useState('');
  const approve = t => run(() => api(`/timesheets/${t.id}/approve`, { method: 'POST' }), `${t.code} approved. Payment queued.`, state.reload);
  const submitDispute = e => { e.preventDefault(); run(() => api(`/timesheets/${dispute.id}/dispute`, { method: 'POST', body: { reason } }), 'Dispute raised. Operations will review it.', () => { setDispute(null); setReason(''); state.reload(); }); };
  return <>
    <PageIntro eyebrow={t('TIME & PAY')} title={t('Timesheets')} desc={t('Hours are calculated by the server from verified clock-in and clock-out times.')} />
    <Async state={state}>{({ timesheets, summary }) => <>
      <div className="stats-grid">
        <Stat label={t('Awaiting review')} value={summary.pending} hint={t('Auto-approved after 24 hours')} tone="orange" icon="clock" />
        <Stat label={t('Approved')} value={summary.approved} hint={t('Ready for payment')} tone="green" icon="check" />
        <Stat label={t('Disputed')} value={summary.disputed} hint={t('With operations')} tone="red" icon="flag" />
        <Stat label={t('Paid')} value={summary.paid} hint={t('Settled')} tone="purple" icon="rupee" />
      </div>
      <Panel>{!timesheets.length ? <Empty icon="clock" title="No timesheets yet" text="They appear automatically when a worker clocks out." /> :
        <div className="table-wrap"><table><thead><tr><th>Timesheet</th><th>Worker</th><th>Shift</th><th>Date</th><th>Hours</th><th>Rate</th><th>Payable</th><th>Status</th><th /></tr></thead><tbody>
          {timesheets.map(t => <tr key={t.id}><td className="id-cell">{t.code}</td><td>{t.worker_name}</td><td>{t.shift_title}<span className="cell-sub">{t.shift_code}</span></td><td>{fmtDate(t.date)}</td><td>{t.hours}</td><td>{money(t.rate)}</td><td><b>{money(t.amount)}</b></td><td><Pill>{t.status}</Pill></td>
            <td><div className="action-pair">
              {t.status === 'Pending' && ['business', 'admin'].includes(user.role) && <button className="btn primary mini" disabled={busy} onClick={() => approve(t)}>Approve</button>}
              {['Pending', 'Approved'].includes(t.status) && user.role !== 'admin' && <button className="btn secondary mini" onClick={() => setDispute(t)}>Dispute</button>}</div></td></tr>)}</tbody></table></div>}
      </Panel></>}</Async>
    {dispute && <Modal title={`Dispute ${dispute.code}`} onClose={() => setDispute(null)}>
      <form className="stack-form" onSubmit={submitDispute}><p className="muted" style={{ margin: 0 }}>{dispute.shift_title} · {dispute.hours} h · {money(dispute.amount)}. Any pending payment is put on hold until operations resolves the case.</p>
        <label className="field">What is wrong?<textarea required minLength={5} rows="4" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Worker left at 3 PM but timesheet shows 5 PM" /></label>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setDispute(null)}>Cancel</button><button className="btn primary" disabled={busy}>Raise dispute</button></div></form></Modal>}
  </>;
}

// ---------------- Payments ----------------
export function Payments({ user, toast, language = 'en' }) {
  const t = key => tr(language, key);
  const state = useLoad(() => api('/payments'), [user.id]);
  const [run, busy] = useAction(toast);
  const [paying, setPaying] = useState(null); const [ref, setRef] = useState('');
  const pay = e => { e.preventDefault(); run(() => api(`/payments/${paying.id}/confirm-payout`, { method: 'POST', body: { reference: ref } }), 'Worker payout recorded.', () => { setPaying(null); setRef(''); state.reload(); }); };
  const checkout = async p => {
    try {
      const order = await api(`/payments/${p.id}/create-order`, { method: 'POST', body: {} });
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load. Check your internet connection and refresh.');
      const checkout = new window.Razorpay({ key: order.key_id, amount: order.amount, currency: order.currency, name: 'H-Staff', description: `Payment ${p.code}`, order_id: order.order_id,
        handler: async response => {
          try { await api(`/payments/${p.id}/verify-checkout`, { method: 'POST', body: response }); toast('Client payment verified. Worker payout is a separate step.'); state.reload(); }
          catch (error) { toast(error.message || 'Could not verify payment. Do not retry payment until status is checked.'); }
        }, modal: { ondismiss: () => toast('Checkout closed. If you completed payment, refresh to check its status.') }, theme: { color: '#4f46e5' } });
      checkout.on('payment.failed', response => toast(response?.error?.description || 'Payment failed. Please try again.'));
      checkout.open();
    } catch (error) { toast(error.message || 'Unable to start checkout.'); }
  };
  return <>
    <PageIntro eyebrow={t('FINANCE')} title={t('Payments & payouts')} desc={t(user.role === 'worker' ? 'Track client collection and your worker payout separately.' : 'Collect client payments securely and track worker settlements.')} />
    <Async state={state}>{({ payments, summary, gateway }) => <>
      <div className="stats-grid three">
        <Stat label={t(user.role === 'worker' ? 'Awaiting payout' : 'Awaiting collection')} value={money(summary.pending_amount)} hint={t('Outstanding amount')} tone="orange" icon="clock" />
        <Stat label={t(user.role === 'worker' ? 'Received' : 'Client funds collected')} value={money(summary.paid_amount)} hint={`${money(summary.paid_this_month)} ${t('this month')}`} tone="green" icon="check" />
        <Stat label={t('Transactions')} value={summary.count} hint={t('All time')} tone="purple" icon="card" />
      </div>
      {!gateway?.configured && user.role !== 'worker' && <div className="info-box"><b>Razorpay setup required</b><p>Checkout is disabled until a Razorpay account is activated and server-side keys are configured. Add RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET to server/.env. Live worker transfers also require approved Razorpay Route/RazorpayX access and verified beneficiary details.</p></div>}
      <Panel>{!payments.length ? <Empty icon="rupee" title={t('No payments yet')} text={t('Payment is created when a timesheet is approved.')} /> :
        <div className="table-wrap"><table><thead><tr><th>{t('Payment')}</th><th>{t('Shift')}</th>{user.role !== 'worker' && <th>{t('Worker')}</th>}{user.role !== 'business' && <th>{t('User')}</th>}<th>{t(user.role === 'worker' ? 'Your net' : 'Client amount')}</th><th>{t('Client collection')}</th><th>{t('Worker payout')}</th><th>{t('Reference')}</th>{(user.role === 'business' || user.role === 'admin') && <th>{t('Action')}</th>}</tr></thead><tbody>
          {payments.map(p => <tr key={p.id}><td className="id-cell">{p.code}<span className="cell-sub">{p.timesheet_code}</span></td><td>{p.shift_title}<span className="cell-sub">{fmtDate(p.date)}</span></td>{user.role !== 'worker' && <td>{p.worker_name}</td>}{user.role !== 'business' && <td>{p.company}</td>}
            <td><b>{money(user.role === 'worker' ? p.net_amount : p.amount)}</b><span className="cell-sub">Platform fee {money(p.fee)}</span></td>
            <td><Pill tone={p.collection_status === 'paid' ? 'green' : p.collection_status === 'failed' ? 'red' : 'orange'}>{p.collection_status || 'unpaid'}</Pill></td>
            <td><Pill tone={(p.payout_status === 'paid' || p.status === 'Paid') ? 'green' : 'orange'}>{p.payout_status || p.status || 'not_started'}</Pill></td>
            <td>{p.razorpay_payment_id || p.payout_reference || p.reference || '—'}</td>
            {(user.role === 'business' || user.role === 'admin') && <td>{user.role === 'business' && p.collection_status !== 'paid' && p.status !== 'Paid' && <button className="btn primary mini" disabled={!gateway?.configured || p.status === 'Paid'} onClick={() => checkout(p)}>Pay with Razorpay</button>}{user.role === 'admin' && p.collection_status === 'paid' && p.payout_status !== 'paid' && p.status !== 'Paid' && <><button className="btn secondary mini" onClick={() => run(() => api(`/payments/${p.id}/queue-payout`, { method: 'POST', body: {} }), 'Payout added to operations queue. No transfer was sent.', state.reload)}>Queue payout</button> <button className="btn primary mini" onClick={() => setPaying(p)}>Record transfer</button></>}</td>}
          </tr>)}</tbody></table></div>}
        <p className="footnote">Client collection is confirmed by Razorpay verification/webhooks. Worker payout is separate: queueing does not transfer funds. Record a payout only after an actual bank/UPI transfer is verified.</p></Panel></>}</Async>
    {paying && <Modal title={`Record worker payout · ${paying.code}`} onClose={() => setPaying(null)}><form className="stack-form" onSubmit={pay}>
      <p className="muted" style={{ margin: 0 }}>Confirm that ₹{Number(paying.net_amount).toFixed(2)} was actually transferred to {paying.worker_name}. This records a real external transfer; it does not send money.</p>
      <label className="field">Bank UTR / UPI transaction reference<input required value={ref} onChange={e => setRef(e.target.value)} minLength={4} maxLength={100} /></label>
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setPaying(null)}>Cancel</button><button className="btn primary" disabled={busy}>Confirm transfer recorded</button></div></form></Modal>}
  </>;
}

// ---------------- Attendance (worker) ----------------
export function Attendance({ user, toast, meta, language = 'en' }) {
  const t = key => tr(language, key);
  const state = useLoad(() => api('/attendance/mine'), [user.id]);
  return <>
    <PageIntro eyebrow={t('ATTENDANCE')} title={t('Clock in / clock out')} desc={t('Scan the business QR code and verify your live GPS location to start or finish work.')} />
    <Async state={state}>{({ assignments, history }) => <section className="attendance-grid">
      <div>{!assignments.length ? <Panel><Empty icon="qr" title={t('No confirmed shifts')} text={t('Once a user accepts your application, the shift appears here.')} /></Panel>
        : assignments.map(a => <Assignment key={a.id} a={a} toast={toast} reload={state.reload} demo={meta?.demo} language={language} />)}</div>
      <div>
        <Panel title={t('How verification works')}><ul className="check-list">
          <li><Icon name="check" size={16} />{t('The signed QR is valid through the shift and a 12-hour grace period')}</li>
          <li><Icon name="check" size={16} />{t('You must be an accepted worker on that shift')}</li>
          <li><Icon name="check" size={16} />{t('Your GPS location must be inside the site geofence')}</li>
          <li><Icon name="check" size={16} />{t('The server records the timestamp and calculates your hours')}</li></ul>
          {meta?.demo && <div className="info-box"><b>Demo tip</b><p>Sign in as the business (abc@hstaff.example) → My Shifts → Manage → Attendance QR. Scan the QR or paste its token. For GPS checks, allow location access and test near the configured site coordinates.</p></div>}</Panel>
        <Panel title={t('Recent attendance')}>{!history.length ? <p className="muted">{t('No attendance yet.')}</p> : <div className="table-wrap"><table><thead><tr><th>{t('Shift')}</th><th>{t('In')}</th><th>{t('Out')}</th></tr></thead><tbody>{history.map(h => <tr key={h.id}><td>{h.title}<span className="cell-sub">{fmtDate(h.date)}</span></td><td>{fmtDateTime(h.clock_in)}</td><td>{h.clock_out ? fmtDateTime(h.clock_out) : <Pill tone="green">{t('On shift')}</Pill>}</td></tr>)}</tbody></table></div>}</Panel>
      </div></section>}</Async></>;
}

function Assignment({ a, toast, reload, demo, language = 'en' }) {
  const t = key => tr(language, key);
  const [token, setToken] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [run, busy] = useAction(toast);
  const att = a.attendance;

  const getPos = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot provide location. Use a device with GPS/location services enabled.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      err => reject(new Error(err.code === 1
        ? 'Location permission was denied. Allow location access in your browser settings and try again.'
        : err.code === 3
          ? 'Getting your location timed out. Move to an area with better GPS reception and retry.'
          : 'Unable to get your location. Turn on location services and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  const go = (endpoint, extra, successMessage) => run(async () => {
    // Always use fresh device coordinates; never trust coordinates encoded in a QR code.
    const pos = await getPos();
    return api(endpoint, { method: 'POST', body: { ...extra, ...pos } });
  }, successMessage, reload);

  return <div className="panel attendance-card">
    <div className="assign-head"><div><h2>{a.code} · {a.title}</h2><p className="muted" style={{ margin: 0 }}>{a.business}</p></div>{att ? <Pill tone={att.clock_out ? 'slate' : 'green'}>{att.clock_out ? 'Completed' : 'On shift'}</Pill> : <Pill>{a.status}</Pill>}</div>
    <div className="location-line"><Icon name="pin" size={16} /> {a.location} · {fmtDate(a.date)} · {shiftTime(a)}{a.lat != null && a.lng != null ? <Pill tone="blue">GPS required · {a.radius_m} m</Pill> : <Pill tone="orange">Site GPS not configured</Pill>}</div>

    {!att && <>
      <label className="field" style={{ marginTop: 12 }}>{t('Shift QR token')}<input placeholder={t('Scan the QR or paste HS1.…')} value={token} onChange={e => setToken(e.target.value.trim())} autoComplete="off" /></label>
      <div className="action-pair" style={{ marginTop: 8 }}>
        <button type="button" className="btn secondary" onClick={() => setScannerOpen(true)} disabled={busy}><Icon name="qr" size={16} /> {t('Scan with camera')}</button>
        <button type="button" className="btn primary" disabled={busy || token.length < 10} onClick={() => go('/attendance/clock-in', { token }, `Clocked in to ${a.title}.`)}><Icon name="check" size={16} /> {t('Verify & clock in')}</button>
      </div>
      {scannerOpen && <QrCameraScanner language={language} onDecode={value => { setToken(value.trim()); setScannerOpen(false); toast(t('QR scanned. Tap Verify & clock in to confirm your live location.')); }} onClose={() => setScannerOpen(false)} />}
      {a.lat == null || a.lng == null ? <p className="footnote">This shift has no complete site GPS pin. Ask the business to set both latitude and longitude before attendance.</p> : <p className="footnote">Camera scanning needs browser camera permission. Location is checked by the server when you clock in.</p>}
    </>}

    {att && !att.clock_out && <>
      <p className="muted">Clocked in at {fmtDateTime(att.clock_in)}.</p>
      <button className="btn primary full" disabled={busy} onClick={() => go('/attendance/clock-out', { shift_id: a.id }, `Clocked out from ${a.title}. Timesheet sent for approval.`)}><Icon name="check" size={16} /> {t('Clock out and verify location')}</button>
    </>}
    {att?.clock_out && <p className="muted">Clocked out at {fmtDateTime(att.clock_out)}. Check Timesheets for the approval status.</p>}
  </div>;
}

function QrCameraScanner({ onDecode, onClose, language = 'en' }) {
  const t = key => tr(language, key);
  const videoRef = useRef(null);
  const callbacks = useRef({ onDecode, onClose });
  const [status, setStatus] = useState(t('Starting camera…'));
  const [error, setError] = useState('');
  callbacks.current = { onDecode, onClose };

  useEffect(() => {
    let stream;
    let stopped = false;
    let frame = 0;
    let detector;

    const stop = () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach(track => track.stop());
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is unavailable. Open this site on localhost or through HTTPS, then paste the QR token manually.');
        }
        if (!('BarcodeDetector' in window)) {
          throw new Error('Automatic QR scanning is not supported by this browser. Use a recent Chrome/Edge browser, or paste the token from the business QR panel.');
        }
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus(t('Point the camera at the user attendance QR code.'));

        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes.find(code => code.rawValue)?.rawValue;
            if (value) {
              stop();
              callbacks.current.onDecode(value);
              return;
            }
          } catch { /* A frame can fail while the camera is focusing; keep scanning. */ }
          if (!stopped) frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, or paste the QR token manually.'
          : e?.name === 'NotFoundError'
            ? 'No camera was found on this device. Paste the QR token manually.'
            : (e?.message || 'Could not start the camera. Paste the QR token manually.'));
        setStatus('Camera unavailable');
        if (stream) stream.getTracks().forEach(track => track.stop());
      }
    };

    start();
    return stop;
  }, []);

  return <div className="qr-scanner panel" role="dialog" aria-label="Scan attendance QR code">
    <div className="assign-head"><h3 style={{ margin: 0 }}>{t('Scan attendance QR')}</h3><button type="button" className="btn secondary mini" onClick={onClose}>{t('Close')}</button></div>
    <video ref={videoRef} className="qr-camera" muted playsInline aria-label="Camera preview for QR scanning" />
    <p className="muted" role="status">{status}</p>
    {error && <div className="info-box"><p>{error}</p></div>}
  </div>;
}

// ---------------- Disputes ----------------
export function Disputes({ user, toast, language = 'en' }) {
  const t = key => tr(language, key);
  const state = useLoad(() => api('/disputes'), [user.id]);
  const [run, busy] = useAction(toast);
  const [creating, setCreating] = useState(false); const [resolve, setResolve] = useState(null);
  const [f, setF] = useState({ subject: '', description: '' });
  const [r, setR] = useState({ outcome: 'approve_as_is', hours: '', resolution: '' });
  const start = d => run(() => api(`/disputes/${d.id}/start`, { method: 'POST' }), `${d.code} is now in progress.`, state.reload);
  const create = e => { e.preventDefault(); run(() => api('/disputes', { method: 'POST', body: f }), 'Issue reported. Operations will respond.', () => { setCreating(false); setF({ subject: '', description: '' }); state.reload(); }); };
  const doResolve = e => { e.preventDefault(); run(() => api(`/disputes/${resolve.id}/resolve`, { method: 'POST', body: { ...r, hours: r.outcome === 'adjust_hours' ? r.hours : undefined } }), 'Dispute resolved.', () => { setResolve(null); state.reload(); }); };
  return <>
    <PageIntro eyebrow={t('OPERATIONS')} title={t('Disputes')} desc={t('Track reported issues and timesheet disputes.')}
      action={user.role !== 'admin' && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> {t('Report an issue')}</button>} />
    <Panel><Async state={state}>{({ disputes }) => !disputes.length ? <Empty icon="flag" title={t('No disputes')} text={t('Everything looks good.')} /> :
      <div className="table-wrap"><table><thead><tr><th>{t('Case')}</th><th>{t('Issue')}</th><th>{t('Raised by')}</th><th>{t('Date')}</th><th>{t('Status')}</th><th /></tr></thead><tbody>
        {disputes.map(d => <tr key={d.id}><td className="id-cell">{d.code}</td><td><b>{d.subject}</b><span className="cell-sub" style={{ maxWidth: 320, whiteSpace: 'normal' }}>{d.resolution ? `Resolution: ${d.resolution}` : d.description}</span></td><td>{d.raised_by_name}</td><td>{fmtDate(d.created_at)}</td><td><Pill>{d.status}</Pill></td>
          <td>{user.role === 'admin' && d.status !== 'Resolved' && <div className="action-pair">
            {d.status === 'Open' && <button className="btn secondary mini" disabled={busy} onClick={() => start(d)}>{t('Start')}</button>}
            <button className="btn primary mini" onClick={() => { setResolve(d); setR({ outcome: d.timesheet_id ? 'approve_as_is' : 'close', hours: '', resolution: '' }); }}>{t('Resolve')}</button></div>}</td></tr>)}</tbody></table></div>}</Async></Panel>
    {creating && <Modal title={t('Report an issue')} onClose={() => setCreating(false)}><form className="stack-form" onSubmit={create}>
      <label className="field">{t('Subject')}<input required minLength={3} value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></label>
      <label className="field">{t('Details')}<textarea rows="4" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <p className="muted" style={{ margin: 0 }}>{t('To dispute hours on a specific timesheet, use the Dispute button on the Timesheets page.')}</p>
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setCreating(false)}>{t('Cancel')}</button><button className="btn primary" disabled={busy}>{t('Submit')}</button></div></form></Modal>}
    {resolve && <Modal title={`Resolve ${resolve.code}`} onClose={() => setResolve(null)}><form className="stack-form" onSubmit={doResolve}>
      <p className="muted" style={{ margin: 0 }}>{resolve.subject}{resolve.description ? ` — ${resolve.description}` : ''}</p>
      <label className="field">Outcome<select value={r.outcome} onChange={e => setR({ ...r, outcome: e.target.value })}>
        {resolve.timesheet_id && <><option value="approve_as_is">Approve timesheet as recorded</option><option value="adjust_hours">Adjust hours and approve</option></>}<option value="close">Close without timesheet change</option></select></label>
      {r.outcome === 'adjust_hours' && <label className="field">Corrected hours<input type="number" step="0.25" min="0" max="24" required value={r.hours} onChange={e => setR({ ...r, hours: e.target.value })} /></label>}
      <label className="field">Resolution note <span className="hint">visible to the person who raised it</span><textarea required minLength={3} rows="3" value={r.resolution} onChange={e => setR({ ...r, resolution: e.target.value })} /></label>
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setResolve(null)}>Cancel</button><button className="btn primary" disabled={busy}>Resolve</button></div></form></Modal>}
  </>;
}
