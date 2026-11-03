import React, { useEffect, useRef, useState } from 'react';
import { api, auth } from '../api.js';
import { Icon } from '../components/ui.jsx';
import { tr } from '../i18n.js';

const DEMOS = [['User', 'abc@hstaff.example', 'Business@12345']];

const WORK = {
  hi: { 'I want work': 'मुझे काम चाहिए', 'I need workers': 'मुझे कामगार चाहिए', 'Register as': 'आप कौन हैं?', 'Skip for now': 'अभी छोड़ें',
    'Register to get work near you.': 'अपने पास काम पाने के लिए रजिस्टर करें।', 'Your skills': 'आपका हुनर', 'Your area': 'आपका इलाका' },
  mr: { 'I want work': 'मला काम हवे', 'I need workers': 'मला कामगार हवेत', 'Register as': 'तुम्ही कोण आहात?', 'Skip for now': 'आता वगळा',
    'Register to get work near you.': 'जवळचे काम मिळवण्यासाठी नोंदणी करा.', 'Your skills': 'तुमचे कौशल्य', 'Your area': 'तुमचा परिसर' },
};
export default function AuthPage({ onAuth, demo, language = 'en', setLanguage = () => {} }) {
  const t = key => WORK[language]?.[key] ?? tr(language, key);
  const [mode, setMode] = useState('login');
  const [adminSignIn, setAdminSignIn] = useState(false);
  const [adminRegister, setAdminRegister] = useState(false);
  const [role, setRole] = useState('user');
  const [f, setF] = useState({ email: '', password: '', name: '', phone: '', skills: '', location: '' });
  const [err, setErr] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneMode, setPhoneMode] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [developmentOtp, setDevelopmentOtp] = useState('');
  const googleButtonRef = useRef(null);
  const [googleError, setGoogleError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [profileTicket, setProfileTicket] = useState('');
  const [registrationUser, setRegistrationUser] = useState(null);
  const [docType, setDocType] = useState('Identity document');
  const documentRef = useRef(null);
  const set = key => e => setF(prev => ({ ...prev, [key]: e.target.value }));

  const completeAuth = result => { auth.set(result.token); onAuth(result.user); };
  const googleAllowed = !adminRegister;
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const authenticateGoogle = async credential => {
    setErr(''); setGoogleError(''); setGoogleLoading(true);
    try {
      const result = await api('/auth/google', { method: 'POST', body: { credential, intent: adminSignIn ? 'admin' : role } });
      if (result.created && false && !adminSignIn) {
        auth.set(result.token);
        setF(prev => ({ ...prev, name: result.user.name, email: result.user.email }));
        setProfileTicket(result.token);
      } else completeAuth(result);
    } catch (error) { setGoogleError(t(error.message)); } finally { setGoogleLoading(false); }
  };
  useEffect(() => {
    const showGoogle = googleAllowed && (adminSignIn || mode === 'login' || mode === 'register');
    if (!showGoogle || !googleClientId || !googleButtonRef.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({ client_id: googleClientId, callback: response => {
        if (response?.credential) void authenticateGoogle(response.credential);
      } });
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(320, googleButtonRef.current.clientWidth || 320), locale: language });
    };
    const existing = document.getElementById('google-identity-services');
    if (window.google?.accounts?.id) render();
    else if (existing) { existing.addEventListener('load', render, { once: true }); }
    else {
      const script = document.createElement('script'); script.id = 'google-identity-services';
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
      script.onload = render; script.onerror = () => setGoogleError(t('Google sign-in could not load. Check your connection and try again.'));
      document.head.appendChild(script);
    }
    return () => { cancelled = true; };
  }, [googleAllowed, googleClientId, adminSignIn, mode, role, language]);
  const submit = async e => {
    e.preventDefault(); setErr(''); setAuthNotice(''); setBusy(true);
    try {
      if (adminRegister) {
        await api('/auth/admin/register', { method: 'POST', body: { name: f.name, email: f.email, password: f.password } });
        setAdminRegister(false);
        setAuthNotice('Admin account created. Sign in with your email and password.');
        return;
      }
      const body = mode === 'login' ? { email: f.email, password: f.password }
        : { role, email: f.email, password: f.password, name: f.name, phone: f.phone || undefined,
            ...(role === 'worker' ? { skills: f.skills || undefined, location: f.location || undefined } : {}) };
      completeAuth(await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body }));
    } catch (error) { setErr(t(error.message)); } finally { setBusy(false); }
  };

  const sendPhoneCode = async () => {
    setErr(''); setDevelopmentOtp(''); setBusy(true);
    try {
      const result = await api('/auth/otp/request', { method: 'POST', body: { phone: `+91${f.phone.replace(/\D/g, '')}`,
        ...(mode === 'register' ? { role, ...(f.name ? { name: f.name } : {}), email: f.email || undefined, skills: f.skills || undefined, location: f.location || undefined } : {}) } });
      setOtpSent(true); setOtp('');
      if (result.delivery === 'development' && result.development_otp) setDevelopmentOtp(result.development_otp);
    } catch (error) { setErr(t(error.message)); } finally { setBusy(false); }
  };
  const verifyPhoneCode = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const result = await api('/auth/otp/verify', { method: 'POST', body: { phone: `+91${f.phone.replace(/\D/g, '')}`, otp,
        ...(mode === 'register' ? { role, ...(f.name ? { name: f.name } : {}), email: f.email || undefined, skills: f.skills || undefined, location: f.location || undefined } : {}) } });
      if (result.created) { auth.set(result.token); setProfileTicket(result.token); }
      else completeAuth(result);
    } catch (error) { setErr(t(error.message)); } finally { setBusy(false); }
  };
  const completeProfile = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const result = await api('/auth/me', { method: 'PUT', body: { name: f.name, email: f.email || undefined, skills: f.skills || undefined, location: f.location || undefined } });
      if (role === 'worker') setRegistrationUser(result.user);
      else onAuth(result.user);
    } catch (error) { setErr(t(error.message)); } finally { setBusy(false); }
  };
  const uploadIdentity = async e => {
    e.preventDefault(); setErr('');
    const file = documentRef.current?.files?.[0];
    if (!file) { setErr(t('Choose a file first')); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.append('doc_type', docType); form.append('file', file);
      await api('/kyc', { method: 'POST', form });
      onAuth(registrationUser, { showKyc: true });
    } catch (error) { setErr(t(error.message)); } finally { setBusy(false); }
  };

  if (registrationUser) return <div className="auth-shell auth-single"><section className="auth-card-wrap"><div className="auth-card auth-registration-step">
    <div className="auth-card-top"><div className="auth-brand-mobile"><span className="brand-mark">H</span><b>H-Staff</b></div><label className="field auth-language">{t('Language')}<select value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('hstaff_language', e.target.value); }}><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></label></div>
    <div className="auth-step-count">{t('Registration step')} 4 / 4</div>
    <h2>{t('Submit identity document')}</h2><p>{t('Your profile is created. Upload a document for admin review before accepting jobs.')}</p>
    <div className="auth-security-note"><Icon name="doc" />{t('Accepted documents')}: {t('Aadhaar, PAN, voter ID, driving licence, or passport. PDF, JPG, PNG up to 5 MB.')}</div>
    <form className="stack-form" onSubmit={uploadIdentity}>
      <label className="field">{t('Document type')}<select value={docType} onChange={e => setDocType(e.target.value)}><option>{t('Identity document')}</option><option>{t('Address proof')}</option></select></label>
      <label className="field">{t('Choose identity document')}<input ref={documentRef} required type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label>
      {err && <div className="form-error" role="alert">{err}</div>}
      <button className="btn primary auth-primary" disabled={busy}>{busy ? t('Uploading securely…') : t('Submit for admin review')}</button>
      <button type="button" className="text-btn auth-resend" disabled={busy} onClick={() => onAuth(registrationUser)}>{t('Skip for now')}</button>
    </form>
    <p className="auth-privacy-note">{t('Documents are stored privately and reviewed by an administrator. Upload does not automatically verify identity.')}</p>
  </div></section></div>;

  if (profileTicket) return <div className="auth-shell auth-single"><section className="auth-card-wrap"><div className="auth-card auth-registration-step">
    <div className="auth-card-top"><div className="auth-brand-mobile"><span className="brand-mark">H</span><b>H-Staff</b></div><label className="field auth-language">{t('Language')}<select value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('hstaff_language', e.target.value); }}><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></label></div>
    <div className="auth-step-count">{t('Registration step')} 3 / {role === 'worker' ? 4 : 3}</div><h2>{t('Complete your profile')}</h2><p>{t('Mobile number verified. Add a few details to set up your account.')}</p>
    <form className="stack-form" onSubmit={completeProfile}><label className="field">{t('Full name')}<input required minLength={2} value={f.name} onChange={set('name')} autoComplete="name" /></label>
      <label className="field">{t('Email')} <span className="hint">{t('optional')}</span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      {role === 'worker' && <><label className="field">{t('Skills')}<input value={f.skills} onChange={set('skills')} placeholder={t('For example: cleaning, loading')} /></label><label className="field">{t('Area')}<input value={f.location} onChange={set('location')} placeholder={t('For example: Kharadi, Pune')} /></label></>}
      {err && <div className="form-error" role="alert">{err}</div>}<button className="btn primary auth-primary" disabled={busy}>{busy ? t('Please wait…') : t('Continue')}</button>
    </form></div></section></div>;

  return <div className="auth-shell">
    <section className="auth-hero">
      <div className="brand"><span className="brand-mark">H</span><div><b>H-Staff</b><small>{t('Local work, close to home')}</small></div></div>
      <div className="auth-hero-copy"><span className="auth-eyebrow">{t('LOCAL WORK. ON DEMAND.')}</span>
        <h1>{t('Find nearby help.')}</h1>
        <p>{t('A simpler way to request local services and connect with nearby verified workers.')}</p>
        <div className="hero-points"><div><Icon name="pin" />{t('Nearby workers and local opportunities')}</div><div><Icon name="check" />{t('Human-reviewed worker verification')}</div><div><Icon name="qr" />{t('Track each job from arrival to completion')}</div><div><Icon name="rupee" />{t('Clear, secure payments')}</div></div>
      </div>
      <small className="auth-copyright">© H-Staff</small>
    </section>
    <section className="auth-card-wrap"><div className="auth-card">
      <div className="auth-card-top"><div className="auth-brand-mobile"><span className="brand-mark">H</span><b>H-Staff</b></div>
        <label className="field auth-language">{t('Language')}<select aria-label={t('Language')} value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('hstaff_language', e.target.value); }}><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></label>
      </div>
      {!adminSignIn && <div className="auth-tabs" role="tablist"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setAdminSignIn(false); setPhoneMode(false); setOtpSent(false); setErr(''); setGoogleError(''); }}>{t('Sign In')}</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setAdminSignIn(false); setPhoneMode(true); setOtpSent(false); setErr(''); setGoogleError(''); }}>{t('Register')}</button></div>}
      <h2>{t(adminRegister ? 'Create Admin account' : adminSignIn ? 'Admin sign in' : mode === 'login' ? 'Sign in to your account' : 'Create your account')}</h2>
      <p>{t(adminRegister ? 'Create a local administrator account for this demo.' : adminSignIn ? 'Sign in with your administrator email and password.' : mode === 'login' ? (phoneMode ? 'Sign in securely with your mobile number.' : 'Sign in to continue to your account.') : (role === 'worker' ? 'Register to get work near you.' : 'Create an account to request nearby help.'))}</p>
      {mode === 'register' && <div className="auth-step-count">{t('Registration step')} {otpSent ? '2' : '1'} / {role === 'worker' ? 4 : 3}</div>}
      {mode === 'register' && !otpSent && !adminRegister && <div className="role-pick" role="radiogroup" aria-label={t('Register as')}>
        <button type="button" role="radio" aria-checked={role === 'worker'} className={role === 'worker' ? 'on' : ''} onClick={() => setRole('worker')}><span>🧰</span><b>{t('I want work')}</b></button>
        <button type="button" role="radio" aria-checked={role === 'user'} className={role === 'user' ? 'on' : ''} onClick={() => setRole('user')}><span>🏠</span><b>{t('I need workers')}</b></button>
      </div>}
      {phoneMode ? <form className="stack-form" onSubmit={otpSent ? verifyPhoneCode : e => { e.preventDefault(); sendPhoneCode(); }}>
        <label className="field">{t('Mobile number')}<span className="phone-input"><span aria-label="India country code">🇮🇳 +91</span><input required type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} placeholder="9876543210" value={f.phone} onChange={e => setF(prev => ({ ...prev, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} autoComplete="tel-national" /></span></label>
        {otpSent && <><p className="auth-otp-instructions">{t(developmentOtp ? 'A local development code was generated; no SMS was sent.' : 'Enter the 6-digit code sent to your mobile. It expires shortly.')} <button type="button" className="text-btn" onClick={() => { setOtpSent(false); setDevelopmentOtp(''); setOtp(''); setErr(''); }}>{t('Change number')}</button></p>
          {developmentOtp && <div className="development-otp-note" role="status"><span>{t('Development OTP (local only)')}</span><strong>{developmentOtp}</strong><small>{t('Enter this code above. It was generated locally; no SMS was sent.')}</small></div>}
          <label className="field">{t('Verification code')}<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} /></label></>}
        {err && <div className="form-error" role="alert">{t(err)}</div>}
        <button className="btn primary auth-primary" disabled={busy}>{busy ? t('Please wait…') : otpSent ? t('Verify and continue') : t('Send verification code')}</button>
        {otpSent && <button className="text-btn auth-resend" type="button" disabled={busy} onClick={sendPhoneCode}>{t('Resend code')}</button>}
      </form> : <form className="stack-form" onSubmit={submit}>
        {adminRegister && <label className="field">{t('Full name')}<input required minLength={2} maxLength={80} value={f.name} onChange={set('name')} autoComplete="name" /></label>}
        <label className="field">{t('Email')}<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label className="field">{t('Password')}<input type="password" required minLength={adminRegister ? 12 : mode === 'register' ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={adminRegister || mode === 'register' ? 'new-password' : 'current-password'} />{adminRegister && <span className="hint">{t('Use at least 12 characters')}</span>}{mode === 'register' && !adminRegister && <span className="hint">{t('At least 8 characters')}</span>}</label>
        {err && <div className="form-error" role="alert">{t(err)}</div>}
        {authNotice && <div className="form-success" role="status">{t(authNotice)}</div>}
        <button className="btn primary auth-primary" disabled={busy}>{busy ? t('Please wait…') : t(adminRegister ? 'Create Admin account' : mode === 'login' ? 'Sign in' : 'Create account')}</button>
        {mode === 'login' && !adminSignIn && <button className="text-btn auth-resend" type="button" onClick={() => { setPhoneMode(true); setOtpSent(false); setErr(''); }}>{t('Sign in with mobile')}</button>}
      </form>}
      {googleAllowed && <div className="google-auth"><div className="auth-divider"><span>{t('or')}</span></div>
        {!adminSignIn && <small className="google-audience-note">{t('Google is optional. Selected account type:')} <b>{t(role === 'worker' ? 'Worker' : 'User')}</b></small>}
        {googleClientId ? <><div ref={googleButtonRef} className="google-button" aria-label={t(adminSignIn ? 'Continue with Google as Admin' : `Continue with Google as ${role === 'worker' ? 'Worker' : 'User'}`)} />{googleLoading && <small>{t('Verifying Google account…')}</small>}</>
          : <button type="button" className="google-placeholder" disabled aria-disabled="true"><GoogleMark />{t('Continue with Google')}</button>}
        {googleError && <small role="alert">{t('Google sign-in could not complete. Please try again.')}</small>}
      </div>}
      {demo && mode === 'login' && !phoneMode && !adminSignIn && <div className="demo-box"><b>{t('Demo accounts')}</b><div>{DEMOS.map(([label, email, password]) => <button key={label} type="button" onClick={() => setF(prev => ({ ...prev, email, password }))}>{t(label)}</button>)}</div></div>}
      <div className="admin-access">{adminSignIn ? <>
        <span>{t(adminRegister ? 'Already have an Admin account?' : 'Administrator access')}</span>
        {adminRegister ? <button type="button" className="text-btn" onClick={() => { setAdminRegister(false); setErr(''); setAuthNotice(''); }}>{t('Admin sign in')}</button> : import.meta.env.DEV && <button type="button" className="text-btn" onClick={() => { setAdminRegister(true); setErr(''); setAuthNotice(''); setGoogleError(''); }}>{t('Create Admin account')}</button>}
        <button type="button" className="text-btn" onClick={() => { setAdminSignIn(false); setAdminRegister(false); setPhoneMode(false); setGoogleError(''); setErr(''); setAuthNotice(''); }}>{t('Back to User sign in')}</button>
      </> : <><span>{t('Platform administrator?')}</span><button type="button" className="text-btn" onClick={() => { setMode('login'); setAdminSignIn(true); setAdminRegister(false); setPhoneMode(false); setErr(''); setAuthNotice(''); setGoogleError(''); }}>{t('Admin sign in')}</button></>}</div>
      <p className="auth-privacy-note">{t('By continuing, you agree to use H-Staff responsibly. Your account and verification details are protected.')}</p>
    </div></section>
  </div>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.73 7.18l7.63 5.92c4.45-4.1 7.14-10.14 7.14-17.57z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.88l-7.63-5.92c-2.12 1.42-4.84 2.26-8.27 2.26-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
}
