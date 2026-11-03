import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon, PageIntro, Panel, Empty, Pill, Stat } from '../components/ui.jsx';

export default function AdminMarketplace({ toast }) {
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const load = useCallback(async () => {
    setBusy(true);
    try { setJobs((await api('/jobs/mine')).jobs); }
    catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  }, [toast]);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  const filtered = useMemo(() => jobs.filter(job => (status === 'All' || job.status === status)
    && `${job.title} ${job.company} ${job.worker_name || ''} ${job.location} ${job.id}`.toLowerCase().includes(query.toLowerCase())), [jobs, query, status]);
  const live = jobs.filter(job => job.status === 'Ongoing').length;
  const searching = jobs.filter(job => job.status === 'Open').length;
  const completed = jobs.filter(job => job.status === 'Completed').length;

  const showLocation = async job => {
    try {
      const result = await api(`/jobs/${job.id}/location`);
      toast(result.location ? `${result.location.lat.toFixed(5)}, ${result.location.lng.toFixed(5)} · ${result.location.updated_at}` : 'No recent GPS point');
    } catch (error) { toast(error.message, 'error'); }
  };

  return <div className="admin-marketplace">
    <PageIntro eyebrow="LIVE OPERATIONS" title="On-demand jobs" desc="Monitor worker matching, active jobs, GPS updates, completion and payment state." action={<button className="btn secondary" disabled={busy} onClick={load}><Icon name="clock" size={16} />{busy ? 'Refreshing…' : 'Refresh'}</button>} />
    <div className="stats-grid three admin-job-stats">
      <Stat label="Requests" value={jobs.length} hint="All on-demand requests" icon="shifts" />
      <Stat label="Searching" value={searching} hint="Waiting for a worker" tone="orange" icon="search" />
      <Stat label="In progress" value={live} hint={`${completed} completed`} tone="green" icon="pin" />
    </div>
    <Panel className="admin-job-panel" title="Marketplace activity" desc="Refreshes automatically every 15 seconds.">
      <div className="filters admin-job-filters">
        <label className="admin-search"><Icon name="search" size={16} /><input placeholder="Search job, user, worker or location" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search on-demand jobs" /></label>
        <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter jobs by status">{['All', 'Open', 'Filled', 'Ongoing', 'Completed', 'Cancelled'].map(value => <option key={value}>{value}</option>)}</select>
        <span className="muted">{filtered.length} shown</span>
      </div>
      {!filtered.length ? <Empty icon="shifts" title={jobs.length ? 'No matching jobs' : 'No on-demand jobs'} text={jobs.length ? 'Change your search or status filter.' : 'New User requests will appear here.'} /> :
        <div className="admin-job-list">{filtered.map(job => <article className="admin-job-card" key={job.id}>
          <div className="admin-job-main"><div className="admin-job-title-row"><span className="admin-job-code">JOB-{String(job.id).padStart(4, '0')}</span><Pill tone={job.status === 'Ongoing' ? 'green' : job.status === 'Open' ? 'orange' : 'slate'}>{job.status}</Pill></div>
            <h3>{job.title}</h3><p><Icon name="pin" size={14} />{job.location || 'Location not provided'}</p>
            <div className="admin-job-meta"><span><b>User</b>{job.company || '—'}</span><span><b>Worker</b>{job.worker_name || 'Searching nearby'}</span><span><b>Schedule</b>{job.date} · {job.start_time}</span><span><b>Rate</b>₹{job.rate}/hr{job.job_amount ? ` · total ₹${job.job_amount}` : ''}</span></div>
          </div><div className="admin-job-side"><div><small>Payment</small><strong>{job.job_payment_status || 'Not due'}</strong></div>{job.status === 'Ongoing' && <button className="btn secondary mini" onClick={() => showLocation(job)}><Icon name="pin" size={14} /> View GPS point</button>}</div>
        </article>)}</div>}
    </Panel>
  </div>;
}
