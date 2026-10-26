import { AppError, requireValue, text, uuid } from '../lib/errors.mjs';
import { authenticate, checkOrigin, setSession,allowedStudent, parseCookies } from '../lib/auth.mjs';
import { request, rpc,rows } from '../lib/db.mjs';
import { beginGoogle,applyDeviceProfile,familyChoices,chooseDeviceProfile,appendCookie,cookie } from '../lib/family-auth.mjs';
import { authConfig,establishNeonSession,sessionStore } from '../lib/neon-session.mjs';
import { basicLoginConfigured,establishBasicSession } from '../lib/basic-auth.mjs';
import { requestContext } from '../lib/neon-data.mjs';
import { saveChecklist,portalCheck,offlineStudy,startTimer,timerTick,gradeAnswer,scopedQuestion,timerCredentials } from '../lib/learning.mjs';
import { uploadMaterial,updateMaterialText,materialText,downloadMaterial } from '../lib/uploads.mjs';
import { dashboard, generatePlan, saveAvailability, savePreferences, saveExam, addQuestion, tutor, conversation } from '../lib/service.mjs';

export async function readBody(req, limit = 128000) {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) req.body = req.body.toString('utf8');
    if (typeof req.body === 'string') {
      requireValue(Buffer.byteLength(req.body) <= limit, 'Request too large.', 413);
      try { req.body = JSON.parse(req.body); } catch { throw new AppError(400, 'Invalid JSON.'); }
    }
    requireValue(req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Buffer.byteLength(JSON.stringify(req.body)) <= limit, 'Invalid or oversized request.');
    return req.body;
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; requireValue(Buffer.byteLength(raw) <= limit, 'Request too large.', 413); }
  try { const value = JSON.parse(raw || '{}'); requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.'); return value; }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError(400, 'Invalid JSON.'); }
}
export default async function handler(req, res) {
  return requestContext.run({}, () => handleRequest(req,res));
}
async function handleRequest(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie, Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let activeRoute='';
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
    activeRoute=route;
    requireValue(['GET','POST'].includes(req.method), 'Method not allowed.', 405);
    if (req.method === 'GET' && route === 'health') {
      res.statusCode = 200; return res.end(JSON.stringify({ status: 'ok', configured: Boolean(process.env.DATABASE_URL && basicLoginConfigured()), version: '2.0.0' }));
    }
    if (route === 'google/start' && req.method === 'GET') return beginGoogle(res);
    if ((route === 'google/callback' || route === 'neondb/auth') && req.method === 'GET') {
      const query = url.searchParams;
      const code = query.get('code') || query.get('token') || query.get('id_token') || query.get('access_token') || query.get('jwt');
      const error = query.get('error');
      if (error) { res.statusCode = 302; res.setHeader('Location', '/?signin=failed'); return res.end(); }
      if (!code) {
        const authBase = process.env.NEON_AUTH_BASE_URL;
        if (authBase) {
          const target = new URL(authBase);
          for (const [name, value] of query.entries()) target.searchParams.set(name, value);
          res.statusCode = 302; res.setHeader('Location', target.href); return res.end();
        }
        res.statusCode = 302; res.setHeader('Location', '/?signin=failed'); return res.end();
      }
      const state = query.get('state');
      const cookies = parseCookies(req.headers.cookie || '');
      let stored = null;
      if (cookies.oauth_state) {
        try { stored = JSON.parse(decodeURIComponent(cookies.oauth_state)); } catch { stored = null; }
      }
      if (state && stored && Number(stored.expires) > Date.now()) {
        const matches = state === stored.verifier || state === JSON.stringify(stored) || state === encodeURIComponent(JSON.stringify(stored));
        if (!matches) throw new AppError(401, 'Sign-in state expired or did not match. Please try again.');
      }
      const session = await establishNeonSession(code);
      setSession(res, session);
      appendCookie(res, cookie('ft_profile', '', 0));
      res.statusCode = 302;
      res.setHeader('Location', '/?signin=success');
      return res.end();
    }
    if (route === 'auth/config' && req.method === 'GET') { const cfg=authConfig();res.statusCode=200;return res.end(JSON.stringify({authUrl:cfg.base})); }
    let body = {};
    if (req.method === 'POST') { checkOrigin(req); body = await readBody(req, route === 'material/upload' ? 3100000 : 128000); }
    if(route==='login'&&req.method==='POST') { if(!basicLoginConfigured()) throw new AppError(401,'Basic login is not enabled.'); const session=await establishBasicSession(body.username,body.password);setSession(res,session);appendCookie(res,cookie('ft_profile','',0));appendCookie(res,cookie('ft_timer','',0));res.statusCode=200;return res.end(JSON.stringify({success:true}));}
    if(route==='google/session'&&req.method==='POST') {const session=await establishNeonSession(body.token);setSession(res,session);appendCookie(res,cookie('ft_profile','',0));appendCookie(res,cookie('ft_timer','',0));res.statusCode=200;return res.end(JSON.stringify({success:true}));}
    if (route === 'logout' && req.method === 'POST') {
      try { const auth = await authenticate(req, res); await sessionStore.revoke(auth.token); } catch { /* Always clear local credentials. */ }
      setSession(res, null); res.statusCode = 200; return res.end(JSON.stringify({ success: true }));
    }
    const auth = await applyDeviceProfile(await authenticate(req, res),req);
    if (auth.deviceProfileMismatch) throw new AppError(403, 'This device profile does not belong to the verified family account.');
    let result;
    if (req.method==='GET' && route==='session') { result={...await familyChoices(auth),selected_profile:auth.selectedProfile,timer_id:timerCredentials(req).id||null}; res.statusCode=200;return res.end(JSON.stringify(result)); }
    if (req.method==='POST' && route==='profile') { const t=timerCredentials(req);if(t.id){try{await timerTick(auth,{session_id:t.id,active:false,finish:true},req,res);}catch{ /* Stale timers expire after two minutes. */ }}result=await chooseDeviceProfile(auth,res,text(body.profile_id,80));res.statusCode=200;return res.end(JSON.stringify(result)); }
    requireValue(auth.selectedProfile,'Choose a family profile to continue.',403);
    Object.assign(requestContext.getStore(),{role:auth.profile.role,studentId:auth.profile.student_id||''});
    if(req.method==='GET' && route==='material/file')return await downloadMaterial(auth,url.searchParams.get('id'),res);
    if (req.method === 'GET' && route === 'dashboard') result = await dashboard(auth);
    else if (req.method === 'GET' && route === 'conversation') result = await conversation(auth, url.searchParams.get('id'));
    else if (req.method === 'GET' && route === 'feedback') {await scopedQuestion(auth,url.searchParams.get('id'),true);result=await rpc('review_answer',{qid:uuid(url.searchParams.get('id'))},{token:auth.token});}
    else if(req.method==='GET' && route==='material/text')result=await materialText(auth,url.searchParams.get('id'));
    else if(req.method==='POST' && route==='checklist')result=await saveChecklist(auth,body);
    else if(req.method==='POST' && route==='portal-check')result=await portalCheck(auth,body);
    else if(req.method==='POST' && route==='offline-study')result=await offlineStudy(auth,body);
    else if(req.method==='POST' && route==='timer/start')result=await startTimer(auth,body,res);
    else if(req.method==='POST' && route==='timer/tick')result=await timerTick(auth,body,req,res);
    else if(req.method==='POST' && route==='grade')result=await gradeAnswer(auth,body);
    else if(req.method==='POST' && route==='material/upload')result=await uploadMaterial(auth,body);
    else if(req.method==='POST' && route==='material/text')result=await updateMaterialText(auth,body);
    else if (req.method === 'POST' && route === 'plan') result = await generatePlan(auth, body);
    else if (req.method === 'POST' && route === 'availability') result = await saveAvailability(auth, body);
    else if (req.method === 'POST' && route === 'preferences') result = await savePreferences(auth, body);
    else if (req.method === 'POST' && route === 'exam') result = await saveExam(auth, body);
    else if (req.method === 'POST' && route === 'question') result = await addQuestion(auth, body);
    else if (req.method === 'POST' && route === 'tutor') result = await tutor(auth, body);
    else if (req.method === 'POST' && route === 'quiz') result = await tutor(auth, body, 'quiz');
    else if (req.method === 'POST' && route === 'complete') { const found=(await rows('study_tasks','id=eq.'+uuid(body.task_id),{token:auth.token}))[0];requireValue(found,'Task not found.',404);await allowedStudent(auth,found.student_id);result=await rpc('complete_task',{task_id:body.task_id},{token:auth.token}); }
    else if (req.method === 'POST' && route === 'answer') {
      requireValue(auth.profile.role==='child','Choose a child profile to answer practice.',403);await scopedQuestion(auth,body.question_id);
      requireValue(Number.isInteger(body.chosen_index) && body.chosen_index >= 0 && body.chosen_index <= 5, 'Choose a valid answer.');
      result = await rpc('submit_answer', { qid: uuid(body.question_id), chosen: body.chosen_index }, { token: auth.token });
    } else if(req.method==='POST' && route==='response') {requireValue(auth.profile.role==='child','Choose a child profile to answer practice.',403);await scopedQuestion(auth,body.question_id);requireValue(body.answer&&typeof body.answer==='object','Enter an answer.');result=await rpc('submit_response',{qid:body.question_id,answer:body.answer},{token:auth.token});}
    else throw new AppError(404, 'Action not found.');
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    if (status === 401) setSession(res, null);
    if(activeRoute==='google/callback'){res.statusCode=302;res.setHeader('Location','/?signin=failed');return res.end();}
    res.statusCode = status;
    // Do not log request bodies, tokens, student chats or upstream secrets.
    if (status === 500) console.error('Tutor request failed:', error.name);
    res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message }));
  }
}
