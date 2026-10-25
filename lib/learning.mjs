import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { rows,rpc,request,eq } from './db.mjs';
import { allowedStudent,parseCookies } from './auth.mjs';
import { appendCookie,cookie } from './family-auth.mjs';
import { text,uuid,requireValue } from './errors.mjs';
import { todayDubai,validDate,addDays } from './dates.mjs';

export async function resolveLesson(auth,sid,id) {
  const student=await allowedStudent(auth,text(sid,80));
  const list=await rows('curriculum',`id=eq.${eq(text(id,300))}&grade=eq.${eq(student.grade)}&status=eq.active`,{token:auth.token});
  requireValue(list[0],'Choose an active portion for this student.');return {student,lesson:list[0]};
}
const checks=['read_material','completed_practice','checked_mistakes','can_explain','needs_help'];
export async function saveChecklist(auth,b) {
  const {student,lesson}=await resolveLesson(auth,b.student_id,b.lesson_id);
  requireValue(checks.every(k=>typeof b[k]==='boolean'),'Confirm each checklist item.');
  const record={student_id:student.id,lesson_id:lesson.id,study_date:todayDubai(),...Object.fromEntries(checks.map(k=>[k,b[k]])),notes:String(b.notes||'').slice(0,2000),confirmed_by:auth.profile.role==='parent'?'parent':'student',updated_at:new Date().toISOString()};
  await request('/rest/v1/lesson_checkins?on_conflict=student_id,lesson_id,study_date',{admin:true,method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:record});
  return {success:true,message:'Checklist saved. Understanding checks and results are tracked separately.'};
}
export async function portalCheck(auth,b) {
  await allowedStudent(auth,text(b.student_id,80));requireValue(typeof b.has_new_material==='boolean','Choose whether you received new material.');
  await request('/rest/v1/portal_checks?on_conflict=student_id,check_date',{admin:true,method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{student_id:b.student_id,check_date:todayDubai(),has_new_material:b.has_new_material,updated_at:new Date().toISOString()}});
  return {success:true};
}
export async function offlineStudy(auth,b) {
  const {student,lesson}=await resolveLesson(auth,b.student_id,b.lesson_id);
  requireValue(Number.isInteger(b.minutes)&&b.minutes>=1&&b.minutes<=480,'Enter 1–480 minutes.');
  requireValue(validDate(b.study_date)&&b.study_date<=todayDubai()&&b.study_date>=addDays(todayDubai(),-30),'Choose a study date in the last 30 days.');
  await request('/rest/v1/offline_study',{admin:true,method:'POST',prefer:'return=minimal',body:{student_id:student.id,lesson_id:lesson.id,minutes:b.minutes,study_date:b.study_date,notes:String(b.notes||'').slice(0,2000),reported_by:auth.profile.role==='parent'?'parent':'student'}});
  return {success:true,message:'Offline study recorded as reported time, separately from the active timer.'};
}
export function timerCredentials(req) { try{return JSON.parse(parseCookies(req.headers.cookie).ft_timer||'{}');}catch{return {};} }
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function startTimer(auth,b,res) {
  const {student,lesson}=await resolveLesson(auth,b.student_id,b.lesson_id);
  const active=await rows('learning_sessions',`student_id=eq.${eq(student.id)}&ended_at=is.null&select=id,last_seen`,{token:auth.token});
  requireValue(!active.some(s=>Date.now()-new Date(s.last_seen).getTime()<120000),'This child already has an active timer on another tab or device. Stop it there, or wait two minutes after it disconnects.',409);
  const id=randomUUID(),key=randomBytes(32).toString('base64url');
  await rpc('start_learning',{sid:student.id,lesson:lesson.id,session_id:id,secret_hash:digest(key)},{token:auth.token});
  appendCookie(res,cookie('ft_timer',JSON.stringify({id,key,student:student.id}),43200));
  return {success:true,id,active_seconds:0};
}
export async function timerTick(auth,b,req,res) {
  const current=timerCredentials(req);uuid(b.session_id);
  requireValue(current.id===b.session_id&&typeof current.key==='string','The timer belongs to another browser session.',409);
  await allowedStudent(auth,current.student);
  requireValue(typeof b.active==='boolean'&&typeof b.finish==='boolean','Invalid timer update.');
  const result=await rpc('learning_heartbeat',{session_id:current.id,secret_hash:digest(current.key),is_active:b.active,finish:b.finish},{token:auth.token});
  if(result.ended)appendCookie(res,cookie('ft_timer','',0));return result;
}
export async function gradeAnswer(auth,b) {
  requireValue(auth.profile.role==='parent','Choose the Parent profile to review answers.',403);
  uuid(b.attempt_id);requireValue(typeof b.correct==='boolean','Choose correct or needs practice.');
  const attempt=(await rows('practice_attempts',`id=eq.${eq(b.attempt_id)}`,{token:auth.token}))[0];requireValue(attempt,'Answer not found.',404);
  await allowedStudent(auth,attempt.student_id,true);
  await rpc('grade_response',{attempt_id:b.attempt_id,is_correct:b.correct,feedback:String(b.feedback||'').slice(0,4000)},{token:auth.token});return {success:true};
}
export async function scopedQuestion(auth,id,requireAttempt=false) {
  uuid(id);const q=(await rows('practice_questions',`id=eq.${eq(id)}`,{token:auth.token}))[0];requireValue(q,'Question not found.',404);
  await allowedStudent(auth,q.student_id);
  if(auth.profile.role==='child'&&requireAttempt){const attempts=await rows('practice_attempts',`question_id=eq.${eq(id)}&student_id=eq.${eq(q.student_id)}`,{token:auth.token});requireValue(attempts.length,'Submit your answer before opening feedback.',403);}
  return q;
}
