import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './ui.jsx';
import { fmtDateTime } from '../format.js';
import { tr } from '../i18n.js';

export default function Notifications({ language = 'en' }) {
  const t = key => tr(language, key);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, notifications: [] });
  const load = useCallback(() => api('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const toggle = async () => { const next = !open; setOpen(next); if (next) { await load(); if (data.unread) { await api('/notifications/read', { method: 'POST' }).catch(() => {}); setTimeout(load, 1500); } } };
  return <>
    <button className="icon-btn" onClick={toggle} aria-label={t('Notifications')}><Icon name="bell" />{data.unread > 0 && <span className="badge">{data.unread}</span>}</button>
    {open && <div className="notif-menu"><header>{t('Notifications')}<button className="text-btn" onClick={() => setOpen(false)}>{t('Close')}</button></header>
      {!data.notifications.length ? <div className="notif-item">{t("You're all caught up.")}</div> : data.notifications.map(n => <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>{n.message}<small>{fmtDateTime(n.created_at)}</small></div>)}</div>}
  </>;
}

