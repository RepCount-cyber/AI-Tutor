import { AsyncLocalStorage } from 'node:async_hooks';
import { transaction } from './postgres.mjs';
import { sessionStore } from './neon-session.mjs';
import { AppError, requireValue } from './errors.mjs';

export const requestContext = new AsyncLocalStorage();
const tables = new Set('profiles students student_accounts parent_students assessments curriculum exams availability materials study_plans study_tasks practice_questions practice_attempts conversations messages legacy_records lesson_checkins portal_checks learning_sessions daily_study offline_study'.split(' '));
const functions = new Set('complete_task submit_answer set_availability review_answer save_exam set_preferences add_question save_weekly_plan consume_ai_budget save_exchange save_ai_questions start_learning learning_heartbeat submit_response grade_response'.split(' '));
const trustedFunctions = new Set(['save_exchange','save_ai_questions']);
function identifier(value) { requireValue(/^[a-z][a-z0-9_]*$/.test(value), 'Invalid database field.'); return '"'+value+'"'; }
const serialize = v => v !== null && typeof v === 'object' ? JSON.stringify(v) : v;

// This is an internal compatibility boundary, NOT a browser-exposed SQL/PostgREST endpoint.
export function compileRequest(path, { method='GET', body, admin=false, prefer='' } = {}) {
  const url = new URL(path, 'https://internal.invalid');
  const values = [], param = v => { values.push(serialize(v)); return '$'+values.length; };
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length);
    requireValue(method === 'POST' && functions.has(name), 'Unknown database action.');
    requireValue(admin || !trustedFunctions.has(name), 'Trusted action only.', 403);
    const args = Object.entries(body || {}).map(([key,value]) => identifier(key)+' => '+param(value));
    return { text:`SELECT public.${identifier(name)}(${args.join(',')}) AS result`, values, rpc:true };
  }
  const name = url.pathname.replace(/^\/rest\/v1\//, '');
  requireValue(tables.has(name), 'Unknown database collection.');
  const table = 'public.'+identifier(name), query=url.searchParams, filters=[];
  for (const [key,value] of query) {
    if (['select','order','limit','offset','on_conflict'].includes(key)) continue;
    const dot=value.indexOf('.'), op=value.slice(0,dot), operand=value.slice(dot+1), column=identifier(key);
    if (['eq','neq','gt','gte','lt','lte'].includes(op)) filters.push(`${column} ${{eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[op]} ${param(operand)}`);
    else if (op==='is' && ['null','true','false'].includes(operand)) filters.push(`${column} IS ${operand.toUpperCase()}`);
    else if (op==='in' && operand.startsWith('(') && operand.endsWith(')')) {
      const items=operand.slice(1,-1).split(','); requireValue(items.length<=500, 'Too many filter values.');
      filters.push(`${column} IN (${items.map(param).join(',')})`);
    } else throw new AppError(400,'Unsupported database filter.');
  }
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  let select=query.get('select')||'*';
  if(select==='*' && name==='learning_sessions' && !admin) select='id,student_id,user_id,lesson_id,started_at,last_seen,last_active,active_seconds,ended_at';
  const columns=select==='*'?'*':select.split(',').map(identifier).join(',');
  if(method==='GET') {
    const order=query.get('order')?.split(',').map(part=>{const [field,dir='asc']=part.split('.');requireValue(['asc','desc'].includes(dir),'Invalid sort.');return identifier(field)+' '+dir;}).join(',');
    const limit=Number(query.get('limit')||1000),offset=Number(query.get('offset')||0);
    requireValue(Number.isInteger(limit)&&limit>0&&limit<=20000&&Number.isInteger(offset)&&offset>=0,'Invalid pagination.');
    return {text:`SELECT ${columns} FROM ${table}${where}${order?' ORDER BY '+order:''} LIMIT ${param(limit)} OFFSET ${param(offset)}`,values};
  }
  requireValue(admin,'Direct writes require the trusted server.',403);
  if(method==='POST') {
    const records=Array.isArray(body)?body:[body];
    requireValue(records.length>0&&records.length<=500&&records.every(r=>r&&typeof r==='object'),'Invalid records.');
    const fields=Object.keys(records[0]); requireValue(fields.length>0&&records.every(r=>Object.keys(r).length===fields.length&&fields.every(k=>Object.hasOwn(r,k))),'Inconsistent records.');
    const tuples=records.map(r=>'('+fields.map(k=>param(r[k])).join(',')+')');
    let conflict='';
    if(prefer.includes('resolution=')) {
      const keys=(query.get('on_conflict')||'id').split(',');
      const update=fields.filter(k=>!keys.includes(k)).map(k=>`${identifier(k)}=EXCLUDED.${identifier(k)}`).join(',');
      conflict=` ON CONFLICT (${keys.map(identifier).join(',')}) `+(prefer.includes('ignore-duplicates')||!update?'DO NOTHING':'DO UPDATE SET '+update);
    }
    return {text:`INSERT INTO ${table} (${fields.map(identifier).join(',')}) VALUES ${tuples.join(',')}${conflict}${prefer.includes('return=representation')?' RETURNING '+columns:''}`,values};
  }
  if(method==='PATCH') {
    requireValue(filters.length&&body&&Object.keys(body).length,'An update must be scoped.');
    const updates=Object.entries(body).map(([k,v])=>identifier(k)+'='+param(v));
    return {text:`UPDATE ${table} SET ${updates.join(',')}${where}`,values};
  }
  throw new AppError(400,'Unsupported database operation.');
}
export async function postgresRequest(path, options={}) {
  if (!process.env.DATABASE_URL && process.env.SUPABASE_URL) {
    const target = new URL(path, process.env.SUPABASE_URL);
    const isRpc = target.pathname.startsWith('/rest/v1/rpc/');
    const headers = {
      'Content-Type': 'application/json',
      apikey: options.admin ? (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '') : (process.env.SUPABASE_ANON_KEY || '')
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.admin && process.env.SUPABASE_SERVICE_ROLE_KEY) headers.Authorization = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
    const fetchOptions = { method: options.method || 'GET', headers };
    if (options.body !== undefined && !['GET', 'HEAD'].includes(fetchOptions.method)) {
      fetchOptions.body = JSON.stringify(options.body);
    }
    const response = await fetch(target, fetchOptions);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = payload?.message || payload?.error || 'Database request failed.';
      throw new AppError(response.status === 401 ? 401 : 403, message);
    }
    return isRpc ? payload?.result ?? payload : payload ?? [];
  }
  const compiled=compileRequest(path,options);
  const user=options.admin?null:await sessionStore.resolve(options.token);
  try {
    return await transaction(async client=>{
      if(user) {
        const context=requestContext.getStore()||{};
        await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.profile_role',$2,true),set_config('app.student_id',$3,true)",[user.id,context.role||'parent',context.studentId||'']);
        await client.query('SET LOCAL ROLE ft_authenticated');
      }
      const result=await client.query(compiled.text,compiled.values);
      return compiled.rpc?result.rows[0]?.result:result.rows;
    });
  } catch(error) {
    if(error instanceof AppError)throw error;
    if(['40001','23505','40P01'].includes(error.code))throw new AppError(409,'This record changed on another device or has an active session. Reload and try again.');
    if(error.code==='42501')throw new AppError(403,'You do not have access to this action.');
    if(['23503','23514','22P02','P0001'].includes(error.code))throw new AppError(400,'The supplied data does not meet the learning record rules.');
    throw new AppError(503,'The Neon database operation failed. Verify the migration and connection.');
  }
}
