import crypto from 'node:crypto';
import { database, closeDatabase } from '../lib/postgres.mjs';
import { saveExam, generatePlan } from '../lib/service.mjs';

const db = database();
const token = crypto.randomBytes(32).toString('base64url');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const userId = 'aff6dfc0-d839-4456-9c69-01632bce946b';
const expiresAt = new Date(Date.now() + 3600000 * 24);

await db.query('insert into private.app_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);

const auth = { token, profile: { id: userId, role: 'parent', display_name: 'Parent' } };

try {
  console.log('1. Saving PT2 exam window for Izan...');
  await saveExam(auth, {
    student_id: 'izan',
    assessment: 'PT2',
    subject: '',
    start_date: '2026-11-23',
    end_date: '2026-12-11'
  });

  console.log('2. Saving PT2 exam window for Zeidin...');
  await saveExam(auth, {
    student_id: 'zeidin',
    assessment: 'PT2',
    subject: '',
    start_date: '2026-11-23',
    end_date: '2026-12-11'
  });

  console.log('3. Generating weekly timetable for Izan (week 2026-10-26)...');
  const planIzan = await generatePlan(auth, {
    student_id: 'izan',
    assessment: 'PT2',
    week_start: '2026-10-26'
  });
  console.log('Izan: Sessions =', planIzan.sessions?.length, 'Warnings =', planIzan.warnings);

  console.log('4. Generating weekly timetable for Zeidin (week 2026-10-26)...');
  const planZeidin = await generatePlan(auth, {
    student_id: 'zeidin',
    assessment: 'PT2',
    week_start: '2026-10-26'
  });
  console.log('Zeidin: Sessions =', planZeidin.sessions?.length, 'Warnings =', planZeidin.warnings);

  console.log('Timetable and exam window successfully saved in live Neon database!');
} finally {
  await db.query('delete from private.app_sessions where token_hash = $1', [tokenHash]);
  await closeDatabase();
}
