import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon, Spinner, useAction } from '../components/ui.jsx';
import Notifications from '../components/Notifications.jsx';
import { KycWorker } from './People.jsx';

/*
 * Worker app (mobile first). Same design system as the User and Admin portals:
 * navy header, indigo accent, white cards, line icons. Built so that a worker who
 * reads little can still use it: one primary action per screen, big touch targets,
 * read-aloud in 3 languages, adjustable text size, no typing needed to ask for help.
 *
 *  Find work  – Uber/Ola-style: go online, jobs arrive one card at a time,
 *               swipe right to accept (or apply), left to skip.
 *  My orders  – accepted work with a progress rail, plus applications waiting for approval.
 *  Profile    – details, documents, language, text size.
 * Pay is tracked by the admin, so the card shows the hourly rate only.
 */

const T = {
  hi: {
    'Find work': 'काम ढूँढें', 'My orders': 'मेरे काम', 'Profile': 'जानकारी', 'Sign out': 'बाहर निकलें', Hello: 'नमस्ते',
    Online: 'ऑनलाइन', Offline: 'ऑफ़लाइन', 'You are online': 'आप ऑनलाइन हैं', 'You are offline': 'आप ऑफ़लाइन हैं',
    'Switch on to get jobs near you': 'पास के काम पाने के लिए चालू करें', 'Receiving jobs near you': 'पास के काम आ रहे हैं',
    'Please turn on location in your phone, then try again.': 'कृपया फ़ोन में लोकेशन चालू करें, फिर दोबारा कोशिश करें।',
    'Verify your documents to get jobs': 'काम पाने के लिए कागज़ात जमा करें', 'Open Profile and upload your documents.': 'जानकारी खोलकर कागज़ात भेजें।',
    Accept: 'लें', Skip: 'छोड़ें', Apply: 'आवेदन करें', 'Instant job': 'तुरंत काम', 'Scheduled shift': 'तय शिफ्ट', 'Needs approval': 'मंज़ूरी चाहिए',
    'per hour': 'प्रति घंटा', away: 'दूर', hours: 'घंटे', 'more jobs': 'और काम', 'Swipe right to accept, left to skip': 'लेने के लिए दाएँ, छोड़ने के लिए बाएँ सरकाएँ',
    'Looking for jobs near you…': 'पास के काम ढूँढ रहे हैं…', 'Stay on this screen. New jobs appear here.': 'इसी स्क्रीन पर रहें। नए काम यहीं दिखेंगे।',
    'Show skipped jobs again': 'छोड़े हुए काम फिर दिखाएँ', 'Switch on to also get instant jobs near you.': 'तुरंत मिलने वाले पास के काम पाने के लिए चालू करें।',
    'Job accepted.': 'काम मिल गया।', 'Applied. You will be told when it is confirmed.': 'आवेदन हो गया। पक्का होने पर बताया जाएगा।', ACCEPT: 'लें', SKIP: 'छोड़ें', APPLY: 'आवेदन',
    Active: 'चालू', Waiting: 'इंतज़ार', Done: 'पूरे', Today: 'आज', 'Next order': 'अगला काम', 'Waiting for approval': 'मंज़ूरी का इंतज़ार', Withdraw: 'वापस लें', 'Application withdrawn.': 'आवेदन वापस ले लिया।',
    'No orders yet': 'अभी कोई काम नहीं', 'Nothing here.': 'यहाँ कुछ नहीं है।', 'When you take an order it will appear here.': 'जब आप कोई काम लेंगे, वह यहाँ दिखेगा।',
    Place: 'जगह', Date: 'तारीख', Time: 'समय', Customer: 'ग्राहक', Rate: 'दर',
    Taken: 'लिया', Reached: 'पहुँचा', Working: 'काम', Finished: 'पूरा',
    'Waiting to start': 'शुरू होने का इंतज़ार', 'Work going on': 'काम चल रहा है', 'Work finished': 'काम पूरा', 'Waiting for customer': 'ग्राहक की पुष्टि का इंतज़ार', Cancelled: 'रद्द',
    'I reached the place': 'मैं पहुँच गया', 'Enter the 6 digit code from the customer': 'ग्राहक से 6 अंकों का कोड लें',
    'My work is finished': 'मेरा काम पूरा हुआ', 'Read aloud': 'सुनें', Directions: 'रास्ता', 'Need help': 'मदद चाहिए',
    'What is the problem?': 'क्या दिक्कत है?', 'Wrong address': 'गलत पता', 'Customer not there': 'ग्राहक नहीं है', 'I will be late': 'मुझे देर होगी',
    'Safety problem': 'सुरक्षा की दिक्कत', 'Something else': 'कुछ और', Close: 'बंद करें',
    'Admin has been told. Please wait for a call.': 'एडमिन को बता दिया गया है। कॉल का इंतज़ार करें।',
    Name: 'नाम', Phone: 'फ़ोन', Area: 'इलाका', Skills: 'हुनर', Documents: 'कागज़ात', Save: 'सेव करें', 'Saved.': 'सेव हो गया।',
    Verification: 'जाँच', Verified: 'जाँच हो गई', Pending: 'जाँच बाकी', Rejected: 'अस्वीकृत', 'Not submitted': 'कागज़ नहीं दिए',
    'Work marked finished.': 'काम पूरा हो गया।', 'Arrival confirmed.': 'पहुँचना पक्का हुआ।', Language: 'भाषा', 'Text size': 'अक्षर का आकार',
    'Profile complete': 'जानकारी पूरी', 'No internet. Showing the last saved list.': 'इंटरनेट नहीं है। पिछली सूची दिख रही है।', 'Find jobs': 'काम ढूँढें',
  },
  mr: {
    'Find work': 'काम शोधा', 'My orders': 'माझी कामे', 'Profile': 'माहिती', 'Sign out': 'बाहेर पडा', Hello: 'नमस्कार',
    Online: 'ऑनलाइन', Offline: 'ऑफलाइन', 'You are online': 'तुम्ही ऑनलाइन आहात', 'You are offline': 'तुम्ही ऑफलाइन आहात',
    'Switch on to get jobs near you': 'जवळची कामे मिळवण्यासाठी चालू करा', 'Receiving jobs near you': 'जवळची कामे येत आहेत',
    'Please turn on location in your phone, then try again.': 'कृपया फोनमध्ये लोकेशन चालू करा, मग पुन्हा प्रयत्न करा.',
    'Verify your documents to get jobs': 'काम मिळवण्यासाठी कागदपत्रे जमा करा', 'Open Profile and upload your documents.': 'माहिती उघडून कागदपत्रे पाठवा.',
    Accept: 'घ्या', Skip: 'सोडा', Apply: 'अर्ज करा', 'Instant job': 'तात्काळ काम', 'Scheduled shift': 'ठरलेली शिफ्ट', 'Needs approval': 'मंजुरी लागते',
    'per hour': 'प्रति तास', away: 'अंतरावर', hours: 'तास', 'more jobs': 'आणखी कामे', 'Swipe right to accept, left to skip': 'घेण्यासाठी उजवीकडे, सोडण्यासाठी डावीकडे सरकवा',
    'Looking for jobs near you…': 'जवळची कामे शोधत आहोत…', 'Stay on this screen. New jobs appear here.': 'याच स्क्रीनवर थांबा. नवीन कामे इथे दिसतील.',
    'Show skipped jobs again': 'सोडलेली कामे पुन्हा दाखवा', 'Switch on to also get instant jobs near you.': 'तात्काळ जवळची कामे मिळवण्यासाठी चालू करा.',
    'Job accepted.': 'काम मिळाले.', 'Applied. You will be told when it is confirmed.': 'अर्ज झाला. पक्के झाल्यावर कळवले जाईल.', ACCEPT: 'घ्या', SKIP: 'सोडा', APPLY: 'अर्ज',
    Active: 'सुरू', Waiting: 'वाट', Done: 'पूर्ण', Today: 'आज', 'Next order': 'पुढचे काम', 'Waiting for approval': 'मंजुरीची वाट', Withdraw: 'मागे घ्या', 'Application withdrawn.': 'अर्ज मागे घेतला.',
    'No orders yet': 'अजून काम नाही', 'Nothing here.': 'येथे काही नाही.', 'When you take an order it will appear here.': 'तुम्ही काम घेतले की ते येथे दिसेल.',
    Place: 'जागा', Date: 'तारीख', Time: 'वेळ', Customer: 'ग्राहक', Rate: 'दर',
    Taken: 'घेतले', Reached: 'पोहोचलो', Working: 'काम', Finished: 'पूर्ण',
    'Waiting to start': 'सुरू होण्याची वाट', 'Work going on': 'काम सुरू आहे', 'Work finished': 'काम पूर्ण', 'Waiting for customer': 'ग्राहकाच्या खात्रीची वाट', Cancelled: 'रद्द',
    'I reached the place': 'मी पोहोचलो', 'Enter the 6 digit code from the customer': 'ग्राहकाकडून 6 अंकी कोड घ्या',
    'My work is finished': 'माझे काम पूर्ण झाले', 'Read aloud': 'ऐका', Directions: 'रस्ता', 'Need help': 'मदत हवी',
    'What is the problem?': 'काय अडचण आहे?', 'Wrong address': 'चुकीचा पत्ता', 'Customer not there': 'ग्राहक नाही', 'I will be late': 'मला उशीर होईल',
    'Safety problem': 'सुरक्षेची अडचण', 'Something else': 'दुसरे काही', Close: 'बंद करा',
    'Admin has been told. Please wait for a call.': 'अ‍ॅडमिनला कळवले आहे. कॉलची वाट पहा.',
    Name: 'नाव', Phone: 'फोन', Area: 'परिसर', Skills: 'कौशल्य', Documents: 'कागदपत्रे', Save: 'सेव्ह करा', 'Saved.': 'सेव्ह झाले.',
    Verification: 'तपासणी', Verified: 'तपासणी झाली', Pending: 'तपासणी बाकी', Rejected: 'नाकारले', 'Not submitted': 'कागदपत्रे दिली नाहीत',
    'Work marked finished.': 'काम पूर्ण झाले.', 'Arrival confirmed.': 'पोहोचणे पक्के झाले.', Language: 'भाषा', 'Text size': 'अक्षरांचा आकार',
    'Profile complete': 'माहिती पूर्ण', 'No internet. Showing the last saved list.': 'इंटरनेट नाही. मागची यादी दिसत आहे.', 'Find jobs': 'काम शोधा',
  },
};
// Pay is tracked by the admin and the API hides it from workers. Flip to true (and stop deleting `rate` in
// server/src/routes/shifts.js) if workers should see the hourly rate on job cards.
const SHOW_PAY = false;
const VOICE = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const SIZES = { m: 16, l: 18, xl: 21 };
const STEPS = [['Taken', 'list'], ['Reached', 'pin'], ['Working', 'clock'], ['Finished', 'check']];
const PROBLEMS = [['pin', 'Wrong address'], ['x', 'Customer not there'], ['clock', 'I will be late'], ['shield', 'Safety problem'], ['info', 'Something else']];
const ACTIVE = ['Open', 'Filled', 'Ongoing'];
const CATEGORY = [
  [/clean|sweep|mop|safai|सफाई|झाड़/i, 'sparkle'], [/cook|chef|kitchen|waiter|food|खाना|रसोई/i, 'utensils'],
  [/load|unload|lift|move|pack|porter|warehouse|helper|हम्माल|माल/i, 'box'], [/deliver|rider|driver|drive|courier|डिलीवरी/i, 'truck'],
  [/paint|पेंट/i, 'paint'], [/plumb|pipe|repair|fitter|नल/i, 'wrench'], [/electric|wire|बिजली/i, 'bolt'], [/garden|mali|माली|plant/i, 'leaf'],
  [/security|guard|watch|गार्ड/i, 'shield'], [/sale|shop|counter|cashier|दुकान/i, 'store'],
];
const iconFor = title => (CATEGORY.find(([re]) => re.test(title || '')) || [0, 'shifts'])[1];

const pad2 = n => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const buzz = ms => { try { navigator.vibrate?.(ms || 60); } catch { /* optional */ } };
const hhmm = s => { const [h, m] = (s || '0:0').split(':').map(Number); return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
const hoursOf = j => { const f = x => { const [h, m] = (x || '0:0').split(':').map(Number); return h * 60 + m; }; return Math.max(0.5, ((f(j.end_time) - f(j.start_time) + 1440) % 1440) / 60); };
const niceDate = d => { try { return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return d; } };
const km = m => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
const dist = (a, b, c, d) => { const r = x => x * Math.PI / 180, x = r(c - a), y = r(d - b); return 6371000 * 2 * Math.asin(Math.sqrt(Math.sin(x / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(y / 2) ** 2)); };
const mapUrl = o => o.lat != null && o.lng != null
  ? `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.location || '')}`;
function speak(text, language) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = VOICE[language] || 'en-IN'; u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch { /* voice is optional */ }
}
const stepsDone = o => o.status === 'Completed' ? 4 : o.status === 'Ongoing' ? (o.completion_requested_at ? 3 : 2) : (o.status === 'Filled' || o.status === 'Open') ? 1 : 0;
function statusOf(o) {
  if (o.applied) return ['Waiting for approval', 'amber'];
  if (o.status === 'Cancelled') return ['Cancelled', 'red'];
  if (o.status === 'Completed') return ['Work finished', 'green'];
  if (o.status === 'Ongoing') return o.completion_requested_at ? ['Waiting for customer', 'amber'] : ['Work going on', 'blue'];
  return ['Waiting to start', 'amber'];
}

/* ------------------------------------------------------------------ shell */
export default function WorkerPortal({ user, toast, refreshUser, language = 'en', setLanguage, logout }) {
  const t = key => T[language]?.[key] ?? key;
  const [tab, setTab] = useState('find');
  const [badge, setBadge] = useState(0);
  const [size, setSize] = useState(() => { try { return localStorage.getItem('hstaff_wp_size') || 'l'; } catch { return 'l'; } });
  const [online, setOnline] = useState(navigator.onLine);
  const kyc = user.profile?.kyc_status || 'Not submitted';
  const changeSize = s => { setSize(s); try { localStorage.setItem('hstaff_wp_size', s); } catch { /* ignore */ } };
  const changeLanguage = l => { setLanguage(l); try { localStorage.setItem('hstaff_language', l); } catch { /* ignore */ } };
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const tabs = [['find', 'Find work', 'pin'], ['orders', 'My orders', 'shifts'], ['profile', 'Profile', 'user']];

  return <div className="wp" style={{ fontSize: SIZES[size] || SIZES.l }}>
    <header className="wp-top">
      <div className="wp-brand"><span className="brand-mark">H</span><div><small>{t('Hello')}</small><b>{(user.name || '').split(' ')[0] || 'H-Staff'}</b></div></div>
      <div className="wp-top-actions">
        <select className="wp-lang" aria-label={t('Language')} value={language} onChange={e => changeLanguage(e.target.value)}>
          <option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option>
        </select>
        <Notifications language={language} />
        <button className="icon-btn wp-out" onClick={logout} aria-label={t('Sign out')}><Icon name="logout" /></button>
      </div>
    </header>
    {!online && <div className="wp-offline"><Icon name="alert" size={16} />{t('No internet. Showing the last saved list.')}</div>}
    <main className="wp-main">
      <div hidden={tab !== 'find'} className="wp-keep"><FindWork user={user} toast={toast} t={t} language={language} kyc={kyc} goOrders={() => setTab('orders')} openProfile={() => setTab('profile')} /></div>
      {tab === 'orders' && <Orders toast={toast} t={t} language={language} kyc={kyc} onCount={setBadge} goFind={() => setTab('find')} />}
      {tab === 'profile' && <ProfileTab user={user} toast={toast} t={t} language={language} refreshUser={refreshUser} kyc={kyc} size={size} changeSize={changeSize} changeLanguage={changeLanguage} logout={logout} />}
    </main>
    <nav className="wp-tabs" aria-label="Worker menu">
      {tabs.map(([k, label, icon]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
        <span className="wp-tab-ico"><Icon name={icon} size={24} />{k === 'orders' && badge > 0 && <i>{badge}</i>}</span><span>{t(label)}</span></button>)}
    </nav>
  </div>;
}

/* -------------------------------------------------------------- find work */
function FindWork({ user, toast, t, language, kyc, goOrders, openProfile }) {
  const verified = kyc === 'Verified';
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locError, setLocError] = useState(false);
  const [instant, setInstant] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('hstaff_voice') === '1'; } catch { return false; } });
  const pos = useRef(null), lastPost = useRef(0), seen = useRef(new Set());

  const getPosition = () => new Promise((ok, no) => !navigator.geolocation ? no(new Error('geo')) :
    navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), no, { enableHighAccuracy: true, timeout: 12000 }));

  const refresh = useCallback(async () => {
    if (!verified) return;
    try {
      const list = (await api('/shifts')).shifts.filter(s => !s.my_application && s.status === 'Open' && s.job_type !== 'ondemand');
      setShifts(list);
    } catch { /* keep last */ }
    if (pos.current) {
      try {
        const r = await api(`/jobs/nearby?lat=${pos.current.lat}&lng=${pos.current.lng}&radius=15000`);
        setInstant(r.jobs);
        const fresh = r.jobs.filter(j => !seen.current.has(j.id));
        fresh.forEach(j => seen.current.add(j.id));
        if (fresh.length) buzz([200, 100, 200]);
      } catch { /* keep last */ }
    }
  }, [verified]);

  const goOnline = async () => {
    setBusy(true); setLocError(false);
    try {
      const p = await getPosition(); pos.current = p;
      await api('/workers/location', { method: 'POST', body: { ...p, available: true } });
      lastPost.current = Date.now(); setOnline(true);
    } catch (e) { if (e.message === 'geo' || typeof e.code === 'number') setLocError(true); else toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const goOffline = async () => {
    setOnline(false); setInstant([]);
    try { if (pos.current) await api('/workers/location', { method: 'POST', body: { ...pos.current, available: false } }); } catch { /* ignore */ }
  };

  useEffect(() => {
    refresh();
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
    const watch = online ? navigator.geolocation?.watchPosition(p => {
      pos.current = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (Date.now() - lastPost.current > 20000) { lastPost.current = Date.now(); api('/workers/location', { method: 'POST', body: pos.current }).catch(() => {}); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 }) : null;
    return () => { clearInterval(poll); if (watch != null) navigator.geolocation.clearWatch(watch); };
  }, [online, refresh]);

  // One feed: instant jobs (accept) + scheduled shifts (apply), nearest / soonest first.
  const feed = useMemo(() => {
    const here = pos.current;
    const items = [
      ...instant.map(j => ({ ...j, kind: 'job', key: `j${j.id}`, distance_m: j.distance_m })),
      ...shifts.map(s => ({ id: s.id, kind: 'shift', key: `s${s.id}`, title: s.title, company: s.business, location: s.location, lat: s.lat, lng: s.lng,
        date: s.date, start_time: s.start_time, end_time: s.end_time, rate: s.rate, distance_m: here && s.lat != null ? Math.round(dist(here.lat, here.lng, s.lat, s.lng)) : null })),
    ].filter(i => !skipped.includes(i.key));
    return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'job' ? -1 : 1) || ((a.distance_m ?? 9e9) - (b.distance_m ?? 9e9)) || (a.date + a.start_time).localeCompare(b.date + b.start_time));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instant, shifts, skipped, online]);
  const top = feed[0];

  const readJob = j => speak(`${j.title}. ${j.location}. ${niceDate(j.date)}. ${hhmm(j.start_time)}.`, language);
  useEffect(() => { if (sound && top) readJob(top); /* eslint-disable-next-line */ }, [top?.key, sound]);
  const toggleSound = () => { const n = !sound; setSound(n); try { localStorage.setItem('hstaff_voice', n ? '1' : '0'); } catch { /* ignore */ } if (!n) window.speechSynthesis?.cancel(); };

  const take = async item => {
    setBusy(true);
    try {
      if (item.kind === 'job') {
        await api(`/jobs/${item.id}/request`, { method: 'POST' });
        toast(t('Job accepted.')); buzz(120); await goOffline(); goOrders();
      } else {
        await api(`/shifts/${item.id}/apply`, { method: 'POST' });
        toast(t('Applied. You will be told when it is confirmed.')); buzz(120); await refresh(); goOrders();
      }
    } catch (e) { toast(e.message, 'error'); refresh(); }
    finally { setBusy(false); }
  };
  const skip = item => setSkipped(s => [...s, item.key]);

  if (!verified) return <section className="wp-card wp-center">
    <span className="wp-bigicon amber"><Icon name="doc" size={34} /></span>
    <h2>{t('Verify your documents to get jobs')}</h2><p>{t('Open Profile and upload your documents.')}</p>
    <button className="wp-btn primary" onClick={openProfile}><Icon name="upload" size={20} />{t('Documents')}</button>
  </section>;

  return <>
    <section className={`wp-status ${online ? 'on' : ''}`}>
      <span className="wp-dot" />
      <div><b>{t(online ? 'You are online' : 'You are offline')}</b><small>{t(online ? 'Receiving jobs near you' : 'Switch on to get jobs near you')}</small></div>
      <button className={`wp-icon-toggle ${sound ? 'on' : ''}`} onClick={toggleSound} aria-label={t('Read aloud')} aria-pressed={sound}><Icon name="speaker" size={20} /></button>
      <button role="switch" aria-checked={online} aria-label={t('Online')} className={`wp-switch ${online ? 'on' : ''}`} disabled={busy} onClick={online ? goOffline : goOnline}><i /></button>
    </section>
    {locError && <div className="wp-alert"><Icon name="pin" size={20} />{t('Please turn on location in your phone, then try again.')}</div>}
    {!online && shifts.length > 0 && !locError && <p className="wp-note"><Icon name="info" size={16} />{t('Switch on to also get instant jobs near you.')}</p>}

    {top ? <>
      <SwipeCard key={top.key} item={top} t={t} busy={busy} onTake={() => take(top)} onSkip={() => skip(top)} onSpeak={() => readJob(top)} />
      <div className="wp-decide">
        <button className="wp-decide-btn no" disabled={busy} onClick={() => skip(top)}><span><Icon name="x" size={28} /></span>{t('Skip')}</button>
        <button className="wp-decide-btn yes" disabled={busy} onClick={() => take(top)}><span><Icon name="check" size={28} /></span>{t(top.kind === 'job' ? 'Accept' : 'Apply')}</button>
      </div>
      <p className="wp-hint"><Icon name="arrowLeft" size={14} />{t('Swipe right to accept, left to skip')}<Icon name="arrowRight" size={14} /></p>
      {feed.length > 1 && <p className="wp-hint">+{feed.length - 1} {t('more jobs')}</p>}
    </> : <section className="wp-card wp-center">
      <div className="wp-radar"><i /><i /><i /><span><Icon name="pin" size={30} /></span></div>
      <h2>{t('Looking for jobs near you…')}</h2><p>{t('Stay on this screen. New jobs appear here.')}</p>
      {skipped.length > 0 && <button className="wp-btn ghost" onClick={() => setSkipped([])}><Icon name="undo" size={18} />{t('Show skipped jobs again')}</button>}
    </section>}
  </>;
}

function SwipeCard({ item: j, t, busy, onTake, onSkip, onSpeak }) {
  const [dx, setDx] = useState(0), [drag, setDrag] = useState(false), [fly, setFly] = useState(0);
  const start = useRef(null);
  const THRESH = 100;
  const hrs = Math.round(hoursOf(j) * 10) / 10;
  const down = e => { if (busy || fly) return; start.current = e.clientX; setDrag(true); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = e => { if (start.current != null) setDx(e.clientX - start.current); };
  const up = () => {
    if (start.current == null) return; start.current = null; setDrag(false);
    if (dx > THRESH) { setFly(1); setTimeout(async () => { await onTake(); setFly(0); setDx(0); }, 200); }
    else if (dx < -THRESH) { setFly(-1); setTimeout(onSkip, 200); }
    else setDx(0);
  };
  const x = fly ? fly * 700 : dx, lean = Math.max(-1, Math.min(1, dx / THRESH));
  return <div className="wp-stage">
    <article className={`wp-job ${drag ? 'drag' : ''}`} style={{ transform: `translateX(${x}px) rotate(${x / 40}deg)` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="wp-stamp yes" style={{ opacity: Math.max(0, lean) }}>{t(j.kind === 'job' ? 'ACCEPT' : 'APPLY')}</span>
      <span className="wp-stamp no" style={{ opacity: Math.max(0, -lean) }}>{t('SKIP')}</span>
      <div className="wp-job-head">
        <span className="wp-bigicon"><Icon name={iconFor(j.title)} size={30} /></span>
        <div><span className={`wp-tag ${j.kind === 'job' ? 'blue' : 'slate'}`}>{t(j.kind === 'job' ? 'Instant job' : 'Scheduled shift')}</span><h2>{j.title}</h2><small>{j.company}</small></div>
        <button className="icon-btn" onPointerDown={e => e.stopPropagation()} onClick={onSpeak} aria-label={t('Read aloud')}><Icon name="speaker" size={20} /></button>
      </div>
      {SHOW_PAY && j.rate != null && <div className="wp-rate"><b>₹{j.rate}</b><span>{t('per hour')}</span></div>}
      <ul className="wp-facts">
        <li><Icon name="pin" size={20} /><div><small>{t('Place')}</small>{j.location}{j.distance_m != null && <em> · {km(j.distance_m)} {t('away')}</em>}</div></li>
        <li><Icon name="calendar" size={20} /><div><small>{t('Date')}</small>{niceDate(j.date)}</div></li>
        <li><Icon name="clock" size={20} /><div><small>{t('Time')}</small>{hhmm(j.start_time)} – {hhmm(j.end_time)} · {hrs} {t('hours')}</div></li>
      </ul>
      {j.kind === 'shift' && <p className="wp-approval"><Icon name="info" size={16} />{t('Needs approval')}</p>}
    </article>
  </div>;
}

/* ----------------------------------------------------------------- orders */
function Orders({ toast, t, language, kyc, onCount, goFind }) {
  const [state, setState] = useState({ loading: true, orders: [] });
  const [view, setView] = useState(null);
  const load = useCallback(async () => {
    try {
      const [jobs, shifts] = await Promise.all([api('/jobs/mine'), api('/shifts?scope=mine')]);
      const instant = jobs.jobs.map(j => ({ ...j, kind: 'job', key: `j${j.id}` }));
      const scheduled = shifts.shifts
        .filter(s => ['Accepted', 'Applied'].includes(s.my_application?.status) && !instant.some(j => j.id === s.id))
        .map(s => ({ id: s.id, kind: 'shift', key: `s${s.id}`, code: s.code, title: s.title, company: s.business, location: s.location, lat: s.lat, lng: s.lng,
          date: s.date, start_time: s.start_time, end_time: s.end_time, rate: s.rate, status: s.status, applied: s.my_application.status === 'Applied' }));
      setState({ loading: false, orders: [...instant, ...scheduled] });
    } catch (e) { setState(prev => ({ ...prev, loading: false, error: navigator.onLine ? e.message : undefined })); }
  }, []);
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load(); }, 15000); return () => clearInterval(id); }, [load]);

  const byTime = (a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time);
  const groups = useMemo(() => ({
    active: state.orders.filter(o => !o.applied && ACTIVE.includes(o.status)).sort(byTime),
    waiting: state.orders.filter(o => o.applied && ACTIVE.includes(o.status)).sort(byTime),
    done: state.orders.filter(o => !ACTIVE.includes(o.status)).sort((a, b) => byTime(b, a)),
  }), [state.orders]);
  useEffect(() => { onCount(groups.active.length + groups.waiting.length); }, [groups, onCount]);

  if (state.loading) return <Spinner />;
  const current = view || (groups.active.length ? 'active' : groups.waiting.length ? 'waiting' : groups.done.length ? 'done' : 'active');
  const list = groups[current], today = localToday();

  return <>
    {state.error && <p className="wp-alert"><Icon name="alert" size={20} />{state.error}</p>}
    {!state.orders.length && !state.error
      ? <section className="wp-card wp-center"><span className="wp-bigicon"><Icon name="shifts" size={34} /></span><h2>{t('No orders yet')}</h2><p>{t('When you take an order it will appear here.')}</p>
        <button className="wp-btn primary" onClick={goFind}><Icon name="pin" size={20} />{t('Find jobs')}</button></section>
      : <>
        <div className="wp-seg" role="tablist">
          {[['active', 'Active'], ['waiting', 'Waiting'], ['done', 'Done']].map(([k, label]) =>
            <button key={k} role="tab" aria-selected={current === k} className={current === k ? 'on' : ''} onClick={() => setView(k)}><b>{groups[k].length}</b><span>{t(label)}</span></button>)}
        </div>
        {!list.length && <p className="wp-none">{t('Nothing here.')}</p>}
        {list.map((o, i) => <OrderCard key={o.key} order={o} today={today} next={current === 'active' && i === 0 && o.status !== 'Ongoing'} toast={toast} t={t} language={language} reload={load} />)}
      </>}
  </>;
}

function OrderCard({ order: o, today, next, toast, t, language, reload }) {
  const [code, setCode] = useState('');
  const [help, setHelp] = useState(false);
  const [run, busy] = useAction(toast);
  const [label, tone] = statusOf(o);
  const done = stepsDone(o);
  const canVerify = o.kind === 'job' && o.status === 'Filled';
  const canFinish = o.kind === 'job' && o.status === 'Ongoing' && !o.completion_requested_at;
  const live = !o.applied && ACTIVE.includes(o.status);
  const verify = () => run(() => api(`/jobs/${o.id}/verify-start`, { method: 'POST', body: { otp: code } }), t('Arrival confirmed.'), () => { buzz(); setCode(''); reload(); });
  const finish = () => run(() => api(`/jobs/${o.id}/complete`, { method: 'POST' }), t('Work marked finished.'), () => { buzz(); reload(); });
  const withdraw = () => run(() => api(`/shifts/${o.id}/apply`, { method: 'DELETE' }), t('Application withdrawn.'), reload);
  const aloud = `${o.title}. ${t('Place')}: ${o.location}. ${t('Date')}: ${o.date}. ${t('Time')}: ${o.start_time} - ${o.end_time}. ${t(label)}.`;
  const report = problem => run(
    () => api('/disputes', { method: 'POST', body: { subject: `Worker help: ${problem} - ${o.title} (${o.code || `JOB-${o.id}`})`.slice(0, 120) } }),
    t('Admin has been told. Please wait for a call.'), () => { buzz(); setHelp(false); });

  return <article className={`wp-card wp-order ${next ? 'next' : ''}`}>
    <div className="wp-order-head">
      <span className="wp-bigicon"><Icon name={iconFor(o.title)} size={26} /></span>
      <div><h2>{o.title}</h2><small>{o.company}{o.date === today ? ` · ${t('Today')}` : ''}</small></div>
      <button className="icon-btn" onClick={() => speak(aloud, language)} aria-label={t('Read aloud')}><Icon name="speaker" size={20} /></button>
    </div>
    <div className="wp-chips">{next && <span className="wp-tag blue">{t('Next order')}</span>}<span className={`wp-tag ${tone}`}>{t(label)}</span></div>
    {live && o.kind === 'job' && <ol className="wp-rail" aria-hidden="true">
      {STEPS.map(([name, icon], i) => <li key={name} className={i < done ? 'done' : i === done ? 'now' : ''}><span><Icon name={i < done ? 'check' : icon} size={16} /></span><small>{t(name)}</small></li>)}
    </ol>}
    <ul className="wp-facts">
      <li><Icon name="pin" size={20} /><div><small>{t('Place')}</small>{o.location}</div></li>
      <li><Icon name="calendar" size={20} /><div><small>{t('Date')}</small>{niceDate(o.date)}</div></li>
      <li><Icon name="clock" size={20} /><div><small>{t('Time')}</small>{hhmm(o.start_time)} – {hhmm(o.end_time)}</div></li>
    </ul>
    {canVerify && <div className="wp-verify">
      <label><span>{t('Enter the 6 digit code from the customer')}</span>
        <input inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} placeholder="••••••" onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
      <button className="wp-btn primary" disabled={busy || code.length !== 6} onClick={verify}><Icon name="pin" size={20} />{t('I reached the place')}</button>
    </div>}
    {canFinish && <button className="wp-btn primary" disabled={busy} onClick={finish}><Icon name="check" size={20} />{t('My work is finished')}</button>}
    {o.applied && <button className="wp-btn ghost" disabled={busy} onClick={withdraw}><Icon name="x" size={18} />{t('Withdraw')}</button>}
    {live && <div className="wp-pair">
      <a className="wp-btn outline" href={mapUrl(o)} target="_blank" rel="noopener noreferrer"><Icon name="navigation" size={18} />{t('Directions')}</a>
      <button className="wp-btn outline danger" onClick={() => setHelp(true)}><Icon name="lifebuoy" size={18} />{t('Need help')}</button>
    </div>}
    {help && <div className="wp-sheet-bg" onClick={() => setHelp(false)}><div className="wp-sheet" role="dialog" aria-label={t('What is the problem?')} onClick={e => e.stopPropagation()}>
      <h3>{t('What is the problem?')}</h3>
      <div className="wp-problems">{PROBLEMS.map(([icon, p]) => <button key={p} disabled={busy} onClick={() => report(p)}><Icon name={icon} size={22} />{t(p)}</button>)}</div>
      <button className="wp-btn ghost" onClick={() => setHelp(false)}>{t('Close')}</button>
    </div></div>}
  </article>;
}

/* ---------------------------------------------------------------- profile */
function ProfileTab({ user, toast, t, language, refreshUser, kyc, size, changeSize, changeLanguage, logout }) {
  const p = user.profile || {};
  const [f, setF] = useState({ name: user.name, phone: user.phone || '', location: p.location || '', skills: p.skills || '' });
  const [run, busy] = useAction(toast);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = e => { e.preventDefault(); run(() => api('/auth/me', { method: 'PUT', body: f }), t('Saved.'), () => { buzz(); return refreshUser(); }); };
  const checks = [['user', 'Name', !!user.name], ['clock', 'Phone', !!user.phone], ['pin', 'Area', !!p.location], ['wrench', 'Skills', !!p.skills], ['doc', 'Documents', kyc === 'Verified']];
  const score = checks.filter(c => c[2]).length;
  const tone = kyc === 'Verified' ? 'green' : kyc === 'Rejected' ? 'red' : 'amber';
  return <>
    <section className="wp-card">
      <div className="wp-score"><div><b>{score}/5</b><span>{t('Profile complete')}</span></div><span className={`wp-tag ${tone}`}>{t('Verification')}: {t(kyc)}</span></div>
      <div className="wp-meter"><i style={{ width: `${score * 20}%` }} /></div>
      <ul className="wp-checks">{checks.map(([icon, name, ok]) => <li key={name} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : icon} size={18} /><small>{t(name)}</small></li>)}</ul>
    </section>
    <section className="wp-card">
      <form className="wp-form" onSubmit={save}>
        <label><span>{t('Name')}</span><input required value={f.name} onChange={set('name')} /></label>
        <label><span>{t('Phone')}</span><input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
        <label><span>{t('Area')}</span><input value={f.location} onChange={set('location')} /></label>
        <label><span>{t('Skills')}</span><input value={f.skills} onChange={set('skills')} /></label>
        <button className="wp-btn primary" disabled={busy}><Icon name="check" size={20} />{t('Save')}</button>
      </form>
    </section>
    <section className="wp-card">
      <h3>{t('Language')}</h3>
      <div className="wp-tiles">{[['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']].map(([k, label]) => <button key={k} className={language === k ? 'on' : ''} onClick={() => changeLanguage(k)}>{label}</button>)}</div>
      <h3>{t('Text size')}</h3>
      <div className="wp-tiles sizes">{[['m', 15], ['l', 19], ['xl', 24]].map(([k, px]) => <button key={k} className={size === k ? 'on' : ''} style={{ fontSize: px }} onClick={() => changeSize(k)} aria-label={`${t('Text size')} ${k}`}>अ A</button>)}</div>
    </section>
    <section className="wp-docs"><KycWorker user={user} toast={toast} language={language} /></section>
    <button className="wp-btn outline danger" onClick={logout}><Icon name="logout" size={20} />{t('Sign out')}</button>
  </>;
}
