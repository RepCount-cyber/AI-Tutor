import { createAuthClient } from '@neondatabase/auth';

let client;
async function authClient() {
  if (client) return client;
  const response = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Google sign-in is not configured yet.');
  const { authUrl } = await response.json();
  client = createAuthClient(authUrl);
  return client;
}

export async function beginGoogleSignIn() {
  const auth = await authClient();
  const result = await auth.signIn.social({ provider: 'google', callbackURL: location.origin });
  if (result?.error) throw new Error(result.error.message || 'Google sign-in could not be started.');
}

export async function exchangeNeonSession() {
  try {
    const auth = await authClient();
    const result = await auth.getSession();
    const token = result?.data?.session?.token;
    if (!token) return false;
    const response = await fetch('/api/google/session', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!response.ok) return false;
    return true;
  } catch {
    return false;
  }
}
