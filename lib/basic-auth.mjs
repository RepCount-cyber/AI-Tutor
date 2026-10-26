import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction } from './postgres.mjs';
import { AppError, requireValue } from './errors.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const comparable = value => createHash('sha256').update(String(value)).digest();
const matches = (received, expected) => timingSafeEqual(comparable(received), comparable(expected));

export function basicLoginConfigured(env = process.env) {
  return Boolean(env.FAMILY_LOGIN_USERNAME && env.FAMILY_LOGIN_PASSWORD);
}

export function basicLoginConfig(env = process.env) {
  requireValue(basicLoginConfigured(env), 'Family Tutor basic login is not configured.', 503);
  return { username: env.FAMILY_LOGIN_USERNAME.trim(), password: env.FAMILY_LOGIN_PASSWORD };
}

export async function establishBasicSession(username, password, env = process.env) {
  const config = basicLoginConfig(env);
  const valid = typeof username === 'string' && username.length <= 120 && typeof password === 'string' && password.length <= 500
    && matches(username.trim().toLowerCase(), config.username.toLowerCase()) && matches(password, config.password);
  requireValue(valid, 'Incorrect username or password.', 401);

  return transaction(async client => {
    const providerId = `family-basic:${config.username.toLowerCase()}`;
    let userId = (await client.query('SELECT user_id FROM private.auth_identities WHERE provider_id=$1', [providerId])).rows[0]?.user_id;
    if (!userId) {
      const parents = (await client.query("SELECT id FROM public.profiles WHERE role='parent' ORDER BY id LIMIT 2")).rows;
      requireValue(parents.length <= 1, 'Family ownership needs review before basic login can be enabled.', 503);
      userId = parents[0]?.id || randomUUID();
      if (!parents[0]) {
        const students = (await client.query('SELECT id FROM public.students')).rows;
        requireValue(students.length === 2, 'Import the two reviewed student records before the first sign-in.', 503);
        await client.query("INSERT INTO public.profiles(id,display_name,role) VALUES($1,'Parent','parent')", [userId]);
        await client.query('INSERT INTO public.parent_students(parent_id,student_id) SELECT $1,id FROM public.students', [userId]);
      }
      await client.query('INSERT INTO private.auth_identities(provider_id,user_id,email) VALUES($1,$2,$3)', [providerId, userId, `basic:${config.username.toLowerCase()}`]);
    }
    const token = randomBytes(32).toString('base64url');
    await client.query('DELETE FROM private.app_sessions WHERE expires_at<now()');
    await client.query("INSERT INTO private.app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token), userId]);
    return { access_token: token, expires_in: 604800 };
  });
}
