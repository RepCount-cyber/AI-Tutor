import { rows, eq } from './db.mjs';
import { sessionStore } from './neon-session.mjs';
import { AppError, requireValue } from './errors.mjs';
import { verifyFamilyUser } from './family-auth.mjs';

export function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* Invalid cookies are not credentials. */ }
  }
  return result;
}
export function setSession(res, session, env = process.env) {
  const secure = env.APP_ORIGIN?.startsWith('https://') ? '; Secure' : '';
  const base = `; HttpOnly; SameSite=Strict; Path=/api${secure}`;
  if (!session) {
    res.setHeader('Set-Cookie', [`ft_access=; Max-Age=0${base}`, `ft_refresh=; Max-Age=0${base}`, `ft_profile=; Max-Age=0${base}`, `ft_timer=; Max-Age=0${base}`]);
  } else {
    res.setHeader('Set-Cookie', [
      `ft_access=${encodeURIComponent(session.access_token)}; Max-Age=${Math.min(Number(session.expires_in) || 3600, 604800)}${base}`,
      `ft_refresh=; Max-Age=0${base}`
    ]);
  }
}
export function checkOrigin(req, env = process.env) {
  const configured = env.APP_ORIGIN;
  requireValue(configured, 'APP_ORIGIN must be configured before signing in.', 503);
  let allowed;
  try { allowed = new URL(configured).origin; } catch { throw new AppError(503, 'Invalid application origin configuration.'); }
  requireValue(req.headers.origin === allowed, 'This request did not come from this tutor application.', 403);
  requireValue((req.headers['content-type'] || '').split(';')[0].trim() === 'application/json', 'Send application/json.', 415);
}
export async function authenticate(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.ft_access;
  const user = token ? await sessionStore.resolve(token) : null;
  if (!user?.id || !token) throw new AppError(401, 'Please sign in to continue.');
  verifyFamilyUser(user);
  const profiles = await rows('profiles', `id=eq.${eq(user.id)}&select=id,display_name,role`, { token });
  const profile = profiles[0];
  if (!profile || profile.role !== 'parent') throw new AppError(403, 'This account is not linked to your family yet.');
  return { token, user, profile };
}
export async function allowedStudent(auth, studentId, parentOnly = false) {
  if (auth.profile.role === 'child' && auth.profile.student_id !== studentId) throw new AppError(409, 'The active profile changed. Reload before saving this child’s work.');
  if (parentOnly && auth.profile.role !== 'parent') throw new AppError(403, 'Only the parent can change these settings.');
  const students = await rows('students', `id=eq.${eq(studentId)}&select=*`, { token: auth.token });
  if (!students[0]) throw new AppError(403, 'You do not have access to this student.');
  return students[0];
}
