import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { database, transaction } from './postgres.mjs';
import { AppError, requireValue } from './errors.mjs';

export function authConfig(env = process.env) {
  if (env.NEON_AUTH_BASE_URL && env.NEON_AUTH_JWKS_URL) {
    const base = new URL(env.NEON_AUTH_BASE_URL), jwks = new URL(env.NEON_AUTH_JWKS_URL);
    requireValue(base.protocol === 'https:' && jwks.protocol === 'https:' && base.origin === jwks.origin, 'Invalid Neon Auth configuration.', 503);
    return { base: base.href.replace(/\/$/, ''), jwks, email: env.FAMILY_GOOGLE_EMAIL.trim().toLowerCase() };
  }
  requireValue(env.FAMILY_GOOGLE_EMAIL && env.APP_ORIGIN, 'Configure Neon Auth and the family Google account before signing in.', 503);
  const appOrigin = new URL(env.APP_ORIGIN);
  return { base: appOrigin.origin + '/api/google/callback', jwks: new URL('/.well-known/jwks.json', appOrigin.origin), email: env.FAMILY_GOOGLE_EMAIL.trim().toLowerCase() };
}
const hash = value => createHash('sha256').update(value).digest('hex');
export const sessionStore = {
  async resolve(token) {
    if (!token) throw new AppError(401, 'Please sign in to continue.');
    if (!process.env.DATABASE_URL && process.env.SUPABASE_URL) {
      return { id: 'local-family-owner', email: process.env.FAMILY_GOOGLE_EMAIL?.trim().toLowerCase(), email_verified: true, app_metadata: { provider: 'google' } };
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new AppError(401, 'Please sign in to continue.');
    const result = await database().query(`SELECT s.user_id AS id, i.email FROM private.app_sessions s JOIN private.auth_identities i ON i.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash(token)]);
    const user = result.rows[0];
    requireValue(user && user.email === process.env.FAMILY_GOOGLE_EMAIL?.trim().toLowerCase(), 'Please sign in to continue.', 401);
    return { ...user, email_verified: true, app_metadata: { provider: 'google' } };
  },
  async revoke(token) { if (token && process.env.DATABASE_URL) await database().query('DELETE FROM private.app_sessions WHERE token_hash=$1', [hash(token)]); }
};
let jwksCache;
export async function establishNeonSession(jwt) {
  const cfg = authConfig();
  requireValue(typeof jwt === 'string' && jwt.length < 16000, 'Sign-in was not completed.', 401);
  if (!jwksCache || jwksCache.url !== cfg.jwks.href) jwksCache = { url: cfg.jwks.href, key: createRemoteJWKSet(cfg.jwks) };
  let claims;
  try { ({ payload: claims } = await jwtVerify(jwt, jwksCache.key, { issuer: cfg.base, algorithms: ['EdDSA'], requiredClaims: ['sub','exp','iat'] })); }
  catch { throw new AppError(401, 'Sign-in expired or could not be verified. Please sign in again.'); }
  return transaction(async client => {
    // Check the provider and verified email in the managed auth records, not browser input.
    const identity = (await client.query(`SELECT u.id,u.email,u."emailVerified" FROM neon_auth."user" u WHERE u.id=$1 AND EXISTS(SELECT 1 FROM neon_auth.account a WHERE a."userId"=u.id AND a."providerId"='google')`, [claims.sub])).rows[0];
    requireValue(identity?.emailVerified === true && identity.email?.toLowerCase() === cfg.email, 'Please use the configured family Google account.', 403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('family-owner-link',0))");
    let userId = (await client.query('SELECT user_id FROM private.auth_identities WHERE provider_id=$1', [claims.sub])).rows[0]?.user_id;
    if (!userId) {
      const existing = (await client.query('SELECT count(*)::int AS n FROM public.profiles')).rows[0].n;
      requireValue(existing === 0, 'Existing family ownership must be explicitly linked to Neon Auth. Follow SETUP.md.', 503);
      const students = (await client.query('SELECT id,grade FROM public.students')).rows;
      requireValue(students.length === 2 && new Set(students.map(s => s.grade)).size === 2, 'Import the two reviewed real student records before the first sign-in.', 503);
      userId = randomUUID();
      await client.query("INSERT INTO public.profiles(id,display_name,role) VALUES($1,'Parent','parent')", [userId]);
      await client.query('INSERT INTO public.parent_students(parent_id,student_id) SELECT $1,id FROM public.students', [userId]);
      await client.query('INSERT INTO private.auth_identities(provider_id,user_id,email) VALUES($1,$2,$3)', [claims.sub,userId,cfg.email]);
    }
    const token = randomBytes(32).toString('base64url');
    await client.query('DELETE FROM private.app_sessions WHERE expires_at<now()');
    await client.query("INSERT INTO private.app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token),userId]);
    return { access_token: token, expires_in: 604800 };
  });
}
