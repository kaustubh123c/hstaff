export const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
export const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = iso => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
};
export const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
export const shiftTime = s => `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}`;
export const toneFor = status => ({
  Open: 'amber', Filled: 'blue', Ongoing: 'green', Completed: 'slate', Cancelled: 'red',
  Pending: 'amber', Approved: 'green', Paid: 'green', Disputed: 'red', Verified: 'green', Rejected: 'red',
  Accepted: 'green', Applied: 'amber', Withdrawn: 'slate', 'In progress': 'blue', Resolved: 'green',
  'Not submitted': 'slate', Active: 'green', Suspended: 'red',
}[status] || 'slate');
