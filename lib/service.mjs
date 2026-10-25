import { rows, allRows, rpc, eq } from './db.mjs';
import { allowedStudent } from './auth.mjs';
import { AppError, requireValue, text, uuid } from './errors.mjs';
import { aiStatus, askAI } from './ai.mjs';
import { todayDubai, validDate, monday } from './dates.mjs';
import { buildPlan, validateSlots } from './planner.mjs';
import { randomUUID } from 'node:crypto';

export async function dashboard(auth) {
  const options = { token: auth.token };
  const familyStudents=await rows('students','select=*&order=id',options);
  const students=auth.profile.role==='child'?familyStudents.filter(s=>s.id===auth.profile.student_id):familyStudents;
  const data = { profile: auth.profile, students, today: todayDubai(), aiEnabled: aiStatus() };
  if (!students.length) return { ...data, assessments: [], curriculum: [], exams: [], availability: [], materials: [], plans: [], tasks: [], questions: [], attempts: [], conversations: [], legacy: [],checkins:[],portalChecks:[],dailyStudy:[],offlineStudy:[],learningSessions:[] };
  // RLS scopes every collection to the caller, even for tampered REST requests.
  const specs = {
    assessments: ['assessments', 'select=*&order=code'], curriculum: ['curriculum', 'select=*&order=id'],
    exams: ['exams', 'select=*&order=start_date,id'], availability: ['availability', 'select=*&order=day,start_minute,id'],
    materials: ['materials', 'select=id,student_id,drive_file_id,title,subject,assessment,lesson_name,lesson_id,summary,material_type,processing_status,extraction_note,created_at,byte_size,object_path&order=created_at.desc,id'],
    checkins:['lesson_checkins','select=*&order=study_date.desc,lesson_id'],portalChecks:['portal_checks','select=*&order=check_date.desc,student_id'],
    dailyStudy:['daily_study','select=*&order=study_date.desc,student_id'],offlineStudy:['offline_study','select=*&order=study_date.desc,id'],
    learningSessions:['learning_sessions','select=id,student_id,user_id,lesson_id,started_at,last_seen,last_active,active_seconds,ended_at&order=started_at.desc,id'],
    plans: ['study_plans', 'select=*&order=week_start.desc,id'], tasks: ['study_tasks', 'select=*&order=scheduled_date,start_minute,id'],
    questions: ['practice_questions', 'select=*&order=created_at.desc,id'], attempts: ['practice_attempts', 'select=*&order=submitted_at.desc,id'],
    conversations: ['conversations', 'select=*&order=created_at.desc,id'], legacy: ['legacy_records', 'select=*&order=id']
  };
  await Promise.all(Object.entries(specs).map(async ([name, [table, query]]) => { const scoped=auth.profile.role==='child'?(name==='curriculum'?query+'&grade=eq.'+eq(students[0].grade):name==='assessments'?query:query+'&student_id=eq.'+eq(auth.profile.student_id)):query;data[name]=await allRows(table,scoped,options); }));
  return data;
}

async function lessonFor(auth, student, id) {
  const lessons = await rows('curriculum', `id=eq.${eq(text(id, 300))}&grade=eq.${eq(student.grade)}&status=eq.active&select=*`, { token: auth.token });
  requireValue(lessons[0], 'Choose an active lesson for this student.');
  return lessons[0];
}
export async function generatePlan(auth, body) {
  const student = await allowedStudent(auth, text(body.student_id, 80), true);
  const data = await dashboard(auth);
  const start = body.week_start || monday(data.today), assessment = text(body.assessment, 80);
  const current = data.plans.find(p => p.student_id === student.id && p.week_start === start);
  const nowMinute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').reduce((sum, n, i) => sum + +n * (i === 0 ? 60 : 1), 0));
  const plan = buildPlan({ ...data, student, assessment, weekStart: start, questions: data.questions, attempts: data.attempts, nowMinute });
  const id = await rpc('save_weekly_plan', { sid: student.id, assessment_code: assessment, starts: start, expected_revision: current?.revision || 0, sessions: plan.sessions, notices: plan.warnings }, { token: auth.token });
  return { success: true, id, ...plan };
}
export async function saveAvailability(auth, body) {
  const student = await allowedStudent(auth, text(body.student_id, 80), true);
  const slots = validateSlots(body.slots);
  await rpc('set_availability', { sid: student.id, slots }, { token: auth.token });
  return { success: true, message: 'Availability saved. Regenerate the affected week to apply it.' };
}
export async function savePreferences(auth, body) {
  const student = await allowedStudent(auth, text(body.student_id, 80), true);
  requireValue(Number.isInteger(body.focus_minutes) && body.focus_minutes >= 5 && body.focus_minutes <= 50, 'Choose a focus length between 5 and 50 minutes.');
  requireValue(body.priorities && typeof body.priorities === 'object' && !Array.isArray(body.priorities) && Object.entries(body.priorities).every(([k,v]) => k.length <= 100 && Number.isInteger(v) && v >= 1 && v <= 3), 'Choose valid subject priorities.');
  await rpc('set_preferences', { sid: student.id, focus_minutes: body.focus_minutes, priorities: body.priorities }, { token: auth.token });
  return { success: true, message: 'Study preferences saved. Regenerate the affected week to apply them.' };
}
export async function saveExam(auth, body) {
  const student = await allowedStudent(auth, text(body.student_id, 80), true);
  requireValue(validDate(body.start_date) && validDate(body.end_date) && body.end_date >= body.start_date, 'Choose valid exam dates.');
  const code = text(body.assessment, 80);
  const assessments = await rows('assessments', `code=eq.${eq(code)}&status=eq.active`, { token: auth.token });
  requireValue(assessments.length, 'Choose an active assessment.');
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0,100) : '';
  if (subject) {
    const lessons = await rows('curriculum', `grade=eq.${eq(student.grade)}&assessment=eq.${eq(code)}&subject=eq.${eq(subject)}&limit=1`, { token: auth.token });
    requireValue(lessons.length, 'This subject is not in the selected assessment.');
  }
  const id = body.id ? text(body.id, 300) : randomUUID();
  await rpc('save_exam', { sid: student.id, exam_id: id, assessment_code: code, exam_subject: subject, starts: body.start_date, ends: body.end_date }, { token: auth.token });
  return { success: true, message: 'Exam saved. Regenerate the affected week to apply this date.' };
}
export async function addQuestion(auth, body) {
  const student = await allowedStudent(auth, text(body.student_id, 80), true);
  const lesson = await lessonFor(auth, student, body.lesson_id);
  requireValue(Array.isArray(body.choices) && body.choices.length >= 2 && body.choices.length <= 4 && body.choices.every(c => typeof c === 'string' && c.trim() && c.length <= 1000) && new Set(body.choices.map(c => c.trim().toLowerCase())).size === body.choices.length, 'Provide two to four distinct answers.');
  requireValue(Number.isInteger(body.correct_index) && body.correct_index >= 0 && body.correct_index < body.choices.length, 'Choose the correct answer.');
  const id = await rpc('add_question', { sid: student.id, lesson: lesson.id, question: text(body.prompt), options: body.choices.map(c => c.trim()), answer: body.correct_index, explanation: text(body.explanation, 8000) }, { token: auth.token });
  return { success: true, id };
}

export async function tutor(auth, body, mode = 'chat') {
  const student = await allowedStudent(auth, text(body.student_id, 80));
  const lesson = await lessonFor(auth, student, body.lesson_id);
  if (!aiStatus()) throw new AppError(503, 'The AI tutor is not connected yet. Study plans and parent-assigned practice are available.');
  requireValue(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.NEON_SERVICE_ROLE_KEY, 'The trusted tutor storage connection is missing.', 503);
  const practiceType=['mcq','fill_blank','short_answer','matching'].includes(body.practice_type)?body.practice_type:'mcq';
  const message = mode === 'quiz' ? 'Create three short practice questions on this lesson using the supplied school material.' : text(body.message, 3000);
  const cid = body.conversation_id ? uuid(body.conversation_id) : randomUUID();
  let history = [];
  if (body.conversation_id) {
    const conversations = await rows('conversations', `id=eq.${eq(cid)}&student_id=eq.${eq(student.id)}&author_id=eq.${eq(auth.user.id)}&lesson_id=eq.${eq(lesson.id)}`, { token: auth.token });
    requireValue(conversations.length, 'This conversation does not belong to your selected lesson and account.', 403);
    history = (await rows('messages', `conversation_id=eq.${eq(cid)}&select=role,content&order=sequence.desc&limit=10`, { token: auth.token })).reverse();
  }
  const materials = (await rows('materials', `student_id=eq.${eq(student.id)}&subject=eq.${eq(lesson.subject)}&select=*&order=id&limit=100`, { token: auth.token }))
    .filter(m => (!m.assessment || m.assessment === lesson.assessment) && (!m.lesson_name || m.lesson_name === lesson.lesson_name)&&m.processing_status==='ready');
  if (mode === 'quiz') requireValue(materials.some(m => m.extracted_text || m.summary), 'Import school material text or a summary before generating grounded practice.');
  requireValue(await rpc('consume_ai_budget', {}, { token: auth.token }), 'You have reached the tutor limit. Please take a break and try again later.', 429);
  const output = await askAI({ mode, grade: student.grade, lesson, materials, history, message, practiceType });
  // Identity, student and lesson were verified above; service credentials never reach the browser.
  if (mode === 'quiz') {
    await rpc('save_ai_questions', { sid: student.id, lesson: lesson.id, questions: output }, { admin: true });
    return { success: true, message: 'Three AI-generated practice questions were saved. Parent review is recommended.' };
  }
  await rpc('save_exchange', { cid, sid: student.id, owner_id: auth.user.id, lesson: lesson.id, user_text: message, assistant_text: output }, { admin: true });
  return { success: true, conversation_id: cid, text: output };
}

export async function conversation(auth, id) {
  uuid(id);
  const found = await rows('conversations', `id=eq.${eq(id)}&select=*`, { token: auth.token });
  requireValue(found[0], 'Conversation not found.', 404);
  await allowedStudent(auth, found[0].student_id);
  return { conversation: found[0], messages: await rows('messages', `conversation_id=eq.${eq(id)}&select=role,content,created_at&order=sequence&limit=200`, { token: auth.token }) };
}
