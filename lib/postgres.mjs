import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { AppError } from './errors.mjs';

let pool;
export function database() {
  if (!process.env.DATABASE_URL) throw new AppError(503, 'Neon database is not connected. Follow SETUP.md.');
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
    pool.on('error', () => console.error('Database pool connection failed.'));
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export async function transaction(work) {
  const client = await database().connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
export async function closeDatabase() { if (pool) { await pool.end(); pool = undefined; } }
