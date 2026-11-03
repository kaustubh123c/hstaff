// Thin fetch wrapper. The JWT lives in localStorage (falls back to memory if storage is blocked).
const BASE = import.meta.env.VITE_API_URL || '/api';
let memToken = null;
let onUnauthorized = () => {};

export const auth = {
  get token() { try { return localStorage.getItem('hstaff_token') ?? memToken; } catch { return memToken; } },
  set(t) { memToken = t; try { t ? localStorage.setItem('hstaff_token', t) : localStorage.removeItem('hstaff_token'); } catch { /* ignore */ } },
  onUnauthorized(fn) { onUnauthorized = fn; },
};

export async function api(path, { method = 'GET', body, form, raw } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth.token) onUnauthorized();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Authenticated file download (token goes in a header, never in the URL).
export async function download(path, filename) {
  const res = await api(path, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
