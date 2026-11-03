import test from 'node:test';
import assert from 'node:assert/strict';
import { tr } from './i18n.js';

test('Worker and User navigation, dashboard, marketplace, job history and account labels translate', () => {
  const phrases = [
    'Dashboard', 'Nearby Jobs', 'My Shifts', 'Payments', 'Profile',
    'USER OVERVIEW', 'WORKER OVERVIEW', 'Recent jobs', 'Available shifts',
    'Create a work request', 'Your requests', 'Worker location',
    'Confirm completion', 'Rate work', 'Payment verified', 'Notifications',
    'Attendance', 'Clock in / clock out', 'Scan with camera',
    'The signed QR is valid through the shift and a 12-hour grace period',
    'Create a new shift', 'Shift date', 'Report an issue', 'Save changes',
    'Continue with Google as User', 'Google sign-in is not configured',
    'Set VITE_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_ID to enable Google sign-in.',
    'Sign in to your account', 'Create the first Admin account from the project terminal:',
    'Google sign-in is currently unavailable.', 'Google sign-in could not complete. Please try again.',
    'Create Admin account', 'Create a local administrator account for this demo.',
    'Use at least 12 characters', 'Admin account created. Sign in with your email and password.',
    'Already have an Admin account?',
    'An account with this email already exists.', 'Admin self-registration is unavailable.',
    'Google sign-in is for User accounts. Worker accounts must use Worker sign-in.',
    'Google sign-in requires an authoritative Gmail or Workspace email identity.',
    'Google is optional. Selected account type:', 'Continue with Google as Worker',
    'This Google account belongs to a Worker account. Choose the matching account type.',
    'This Google account belongs to a User account. Choose the matching account type.',
    'Authorized administrators only. Use your provisioned account.', 'Back to User and Worker sign in',
    'Book trusted local help without the guesswork.',
    'See nearby work, choose a shift, and track your earnings.', 'Hi',
  ];
  for (const language of ['hi', 'mr']) {
    for (const phrase of phrases) {
      assert.notEqual(tr(language, phrase), phrase, `${language} translation missing for ${phrase}`);
    }
  }
  for (const phrase of phrases) assert.equal(tr('en', phrase), phrase);
});

test('unsupported locale and unknown labels retain readable source text', () => {
  assert.equal(tr('en', 'A custom job title'), 'A custom job title');
  assert.equal(tr('xx', 'A custom job title'), 'A custom job title');
});
