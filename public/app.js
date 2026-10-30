import { sampleData } from './sample.js';
import {configureJarvis,jarvisHTML,stopJarvisVoice} from './jarvis.js';
import {configureLearningUI,portionsView,studyView,practiceView as learningPracticeView,uploadPanel,dailyPanel,timeSummary,heartbeat} from './learning-ui.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icons = {
  home:'M3 10 12 3l9 7v10H3z M9 20v-7h6v7', week:'M4 5h16v16H4z M7 3v4m10-4v4M4 10h16m-11 4h2m4 0h2m-8 4h2',
  tutor:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', practice:'M8 4H5v17h14V4h-3M8 3h8v4H8zM8 12h8m-8 4h5',
  materials:'M4 4h7l2 3h7v14H4z', progress:'M4 20h17M7 16v-5m5 5V7m5 9V3', settings:'M4 7h16M4 17h16M9 4v6m6 4v6',
  arrow:'M4 12h16m-6-6 6 6-6 6', chevron:'m9 5 7 7-7 7', check:'m5 12 4 4L19 6', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2',
  logout:'M9 4H4v16h5m5-4 4-4-4-4m-5 4h12', leaf:'M20 4C7 3 2 9 6 16c5 8 16 1 14-12M5 21l10-11',
  plus:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6', book:'M12 6C8 3 3 4 3 4v15s5-1 9 2c4-3 9-2 9-2V4s-5-1-9 2m0 0v15',
  send:'m3 3 18 9-18 9 3-9zM6 12h15', external:'M14 3h7v7m0-7-10 10M10 4H4v16h16v-6', lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3'
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.book}"/></svg>`;
const nav = [['overview','home','Overview'],['week','week','My week'],['tutor','tutor','Ask tutor'],['practice','practice','Practice'],['portions','check','Portions'],['study','clock','Study log'],['materials','materials','Materials'],['progress','progress','Progress'],['settings','settings','Settings']];
const preview = document.body.dataset.preview === 'true';
const state = { data:null, page:'overview', studentId:null, assessment:'', week:'', subject:'', lessonId:'', messages:[], conversationId:null, readOnlyConversation:false, results:{}, sending:false, familySession:null,timerId:null,timerSeconds:0,timerPaused:false };
let toastTimer, loadVersion = 0;
const brand = `<div class="row brand"><span class="brand-mark" aria-hidden="true">f<span>t</span></span><span class="brand-name">family<em>tutor</em></span></div>`;
const art = `<div class="garden" aria-hidden="true"><span class="garden-sun"></span><span class="garden-star">✧</span><span class="garden-book"></span><span class="garden-stem"></span></div>`;
function notify(message, error = false) {
  const box = $('#notification'); box.textContent = message; box.classList.toggle('error', error); box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, error ? 11000 : 6000);
}
async function api(route, body) {
  if (preview) throw new Error('This sample preview is read-only. Connect your family accounts to save real work.');
  let res;
  try { res = await fetch(`/api/${route}`, { credentials:'same-origin', cache:'no-store', ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) }); }
  catch { throw new Error('The connection was interrupted. Please try again.'); }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && route !== 'login') { state.data = null; loginView('Your session has ended. Please sign in again.'); }
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}
function currentStudent() { return state.data.students.find(s => s.id === state.studentId) || state.data.students[0]; }
function own(collection) { return state.data[collection].filter(r => r.student_id === currentStudent()?.id); }
function lessons() { const s=currentStudent(); return state.data.curriculum.filter(c => c.grade === s?.grade && c.assessment === state.assessment && c.status === 'active'); }
function currentLesson() { return lessons().find(l => l.id === state.lessonId); }
function subjects() { return [...new Set(lessons().map(l => l.subject))].sort(); }
function parent() { return state.data?.profile.role === 'parent'; }
function initials(name) { return String(name || '').split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase(); }
function addDays(date,n) { return new Date(new Date(`${date}T12:00:00Z`).getTime()+n*86400000).toISOString().slice(0,10); }
function monday(date) { return addDays(date,-((new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7)); }
function shortDate(date, options = {}) { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...options}).format(new Date(`${date}T12:00:00Z`)); }
function minutes(n) { return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
function resetLesson() { state.subject=''; state.lessonId=''; state.messages=[]; state.conversationId=null; state.readOnlyConversation=false; }
function syncSelection() {
  const student = currentStudent(); if (!student) return;
  state.studentId=student.id;
  const codes=[...new Set(state.data.curriculum.filter(c=>c.grade===student.grade && c.status==='active').map(c=>c.assessment))];
  if (!codes.includes(state.assessment)) {
    const exam=own('exams').find(e=>e.end_date>=state.data.today && codes.includes(e.assessment));
    state.assessment=exam?.assessment || codes[0] || '';
  }
  if (!state.week) state.week=monday(state.data.today);
}
async function reload(render=true) {const session=await api('session');state.familySession=session;state.timerId=session.timer_id||null;if(!session.selected_profile){state.data=null;profilePicker(session);return;}state.data=await api('dashboard');state.timerSeconds=state.data.learningSessions.find(t=>t.id===state.timerId)?.active_seconds||0;syncSelection();if(render)renderApp();}
function empty(message, action='') { return `<div class="empty">${icon('book')}<p>${esc(message)}</p>${action}</div>`; }
function option(value,label,selected=false) { return `<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`; }
function assessmentOptions() { return state.data.assessments.filter(a=>a.status==='active' && state.data.curriculum.some(c=>c.grade===currentStudent()?.grade && c.assessment===a.code)).map(a=>option(a.code,`${a.code} · ${a.name}`,a.code===state.assessment)).join(''); }
function sectionHeading(title,description,extra='') { const picker=['overview','progress','tutor','practice'].includes(state.page)&&lessons().length?`<div class="heading-assessment"><label for="page-assessment">Assessment</label><select id="page-assessment" data-select="assessment">${assessmentOptions()}</select></div>`:'';return `<div class="page-heading"><div><div class="eyebrow greeting-date">${esc(currentStudent()?.grade || 'Your family space')} · ${esc(state.assessment || 'Curriculum')}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${extra||picker}</div>`; }
function loginView(message='') {
  const failure=new URLSearchParams(typeof location==='undefined'?'':location.search).get('signin');
  $('#app').innerHTML=`<div class="login"><section class="login-story">${brand}<div><span class="eyebrow">Made for your family</span><h1 class="serif">Small steps.<br>Big discoveries.</h1><p>A thoughtful place to study, ask Jarvis, and grow a little more confident every day.</p>${art}</div><div class="login-footer">Learn · Practise · Reflect · Grow</div></section><main class="login-form-side" id="main"><div class="login-form-wrap"><span class="pill">Your family learning space</span><h2>Welcome back.</h2><p class="muted">Sign in to choose a child or Parent profile.</p>${message||failure?`<div class="notice info">${esc(message||'Sign-in could not be completed. Please try again.')}</div>`:''}<form id="login-form" class="details-form"><div class="field"><label for="login-username">Username</label><input id="login-username" name="username" type="text" autocomplete="username" maxlength="120" required></div><div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="500" required></div><p id="login-error" class="notice error" aria-live="polite"></p><button type="submit" class="btn">Sign in</button></form><p class="login-helper">Each device keeps its own selected profile.<br>Everyone can study at the same time.</p><div class="login-demo"><a href="/demo.html">Explore the sample family preview →</a></div></div></main></div>`;
}
function profilePicker(session) {
  stopJarvisVoice();
  $('#app').innerHTML=`<main id="main" class="profile-picker">${brand}<span class="eyebrow">ONE FAMILY · YOUR OWN LEARNING SPACE</span><h1 class="serif">Who’s here to learn?</h1><p class="muted">Choose a profile for this device. No PIN needed.</p><div class="profile-options">${session.choices.map(c=>`<button type="button" class="profile-option" data-select-profile="${esc(c.id)}"><span class="profile-portrait ${c.role==='parent'?'parent-portrait':''}">${c.role==='parent'?icon('leaf'):esc(initials(c.name))}</span><strong>${esc(c.name)}</strong><small>${esc(c.grade||'Both children, together')}</small></button>`).join('')}</div><button class="link-button" data-action="logout">Sign out on this device</button></main>`;
}
function renderApp() {
  configureJarvis(()=>({enabled:state.data?.aiEnabled,profileKey:state.data?.profile.role+':'+state.studentId,studentName:currentStudent()?.display_name,lessonId:state.lessonId,lessons:lessons()}),async(message,conversation)=>{const result=await api('tutor',{student_id:currentStudent().id,lesson_id:state.lessonId,message,conversation_id:conversation});return result;},async id=>{if(state.timerId)await heartbeat(true);resetLesson();state.lessonId=id;state.subject=currentLesson()?.subject||'';renderApp();});
  const data=state.data, student=currentStudent(), title=nav.find(n=>n[0]===state.page)?.[2] || 'Overview';
  const content=!student?empty('Your account is signed in, but student records have not been linked yet. The parent can complete account setup.'):views[state.page]();
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar">${brand}<div class="side-caption">YOUR LEARNING SPACE</div><nav class="nav" aria-label="Main navigation">${nav.filter(n=>n[0]!=='settings'||parent()).map(([id,i,label])=>`<button type="button" data-page="${id}" class="${state.page===id?'active':''}" aria-label="${label}"${state.page===id?' aria-current="page"':''}>${icon(i)}<span class="nav-label">${label}</span></button>`).join('')}</nav><div class="side-bottom"><div class="side-note">${icon('leaf')}<strong>Progress takes practice.</strong><p>Every question is a good place to start.</p></div><div class="account"><div class="avatar">${esc(initials(data.profile.display_name))}</div><div class="grow"><strong>${esc(data.profile.display_name)}</strong><span>${parent()?'Parent account':'Student account'}</span></div><button class="icon-button" data-action="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div></div></aside><div class="workspace">${preview?`<div class="preview-banner"><strong>Sample preview</strong> · Fictional records · Read-only<a href="/demo.html?view=${parent()?'child':'parent'}">View as ${parent()?'child':'parent'}</a><a href="/">Go to real sign in</a></div>`:''}<header class="topbar"><button class="link-button" data-action="choose-profile">Switch profile</button><div class="breadcrumb">Your learning space ${icon('chevron')} <strong>${esc(title)}</strong></div><div class="mobile-brand"><span class="brand-mark">f<span>t</span></span><strong>familytutor</strong></div><div class="topbar-date">${icon('week')}<span>${esc(shortDate(data.today,{weekday:'long',year:'numeric'}))} · UAE</span><span class="pill"><span class="dot"></span>${parent()?'Parent space':esc(student?.grade || 'Student')}</span><button class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></header><main id="main" class="main">${parent() && data.students.length?`<div class="student-tabs" role="group" aria-label="Choose your child">${data.students.map(s=>`<button class="student-tab ${s.id===student?.id?'active':''}" data-student="${esc(s.id)}" aria-pressed="${s.id===student?.id}">${icon('book')}${esc(s.display_name)}<small>${esc(s.grade)}</small></button>`).join('')}</div>`:''}${content}${jarvisHTML()}<p class="footer-note">A little progress, every day. · Family Tutor</p></main></div></div>`;
}
function studentMetrics(sid) {
  const attempts=state.data.attempts.filter(a=>a.student_id===sid&&typeof a.correct==='boolean'), tasks=state.data.tasks.filter(t=>t.student_id===sid);
  return { attempts, accuracy:attempts.length?Math.round(100*attempts.filter(a=>a.correct).length/attempts.length):null,
    due:tasks.filter(t=>t.scheduled_date===state.data.today), missed:tasks.filter(t=>t.scheduled_date<state.data.today && t.status==='planned').length };
}
function stat(label,value,foot,i,suffix='') { return `<article class="card stat"><div class="stat-head">${esc(label)}<span class="stat-icon">${icon(i)}</span></div><div class="stat-value">${esc(value)}${suffix?`<small>${esc(suffix)}</small>`:''}</div><p class="stat-foot">${esc(foot)}</p></article>`; }
function taskHTML(t) {
  const missed=t.status==='planned'&&t.scheduled_date<state.data.today;
  return `<article class="task"><div class="task-check ${t.status==='done'?'done':''}">${icon(t.status==='done'?'check':'book')}</div><div class="grow"><span class="pill ${missed?'orange':''}">${esc(t.subject)}</span><h3>${esc(t.topic)}</h3><div class="task-meta">${icon('clock')}${minutes(t.start_minute)} · ${t.planned_minutes} min<span>·</span>${esc(t.activity)}</div><div class="task-actions">${t.status==='done'?'<span class="pill gray">Completed · understanding checked separately</span>':`<button class="link-button" data-start-task="${esc(t.id)}">Study this ${icon('arrow')}</button>${t.scheduled_date<=state.data.today?`<button class="link-button" data-complete="${esc(t.id)}">Mark done ${icon('check')}</button>`:''}${missed?'<span class="pill orange">Missed</span>':''}`}</div></div></article>`;
}
function examHTML(e) {
  const date=new Date(`${e.start_date}T12:00:00Z`), days=Math.ceil((date-new Date(`${state.data.today}T12:00:00Z`))/86400000);
  return `<article class="exam-item"><div class="date-tile"><small>${esc(date.toLocaleString('en-GB',{month:'short',timeZone:'UTC'}))}</small><strong>${date.getUTCDate()}</strong></div><div class="grow"><h3>${esc(e.subject || e.assessment+' assessment window')}</h3><p>${esc(e.assessment)} · ${esc(shortDate(e.start_date))}${e.end_date!==e.start_date?' – '+esc(shortDate(e.end_date)):''}</p></div><span class="pill ${days<=7?'orange':'gray'}">${days<0?'In progress':days===0?'Today':days+' days'}</span></article>`;
}
function overview() {
  const s=currentStudent(), m=studentMetrics(s.id), portion=lessons(), completed=new Set(own('tasks').filter(t=>t.status==='done').map(t=>t.lesson_id));
  const coverage=portion.filter(l=>completed.has(l.id)).length;
  const upcoming=own('exams').filter(e=>e.end_date>=state.data.today).slice(0,4);
  const tasks=m.due.length?m.due:own('tasks').filter(t=>t.scheduled_date>state.data.today&&t.status==='planned').slice(0,3);
  const weak=weakLessons().slice(0,3);
  const family=parent()?`<div class="family-cards">${state.data.students.map(c=>{const cm=studentMetrics(c.id);return `<article class="card family-card ${s.id===c.id?'selected':''}"><div class="row"><div class="avatar">${esc(initials(c.display_name))}</div><div class="grow"><strong>${esc(c.display_name)}</strong><p>${esc(c.grade)} · ${cm.due.filter(t=>t.status==='done').length}/${cm.due.length} tasks done today</p></div></div><p>${timeSummary(c.id).active} active minutes · ${timeSummary(c.id).offline} reported offline today</p><p>${cm.attempts.length?`${cm.accuracy}% practice accuracy · ${cm.attempts.length} answers`:'No practice results yet'}${cm.missed?` · ${cm.missed} missed tasks`:''}</p><button class="link-button" data-student="${esc(c.id)}">View learning ${icon('arrow')}</button></article>`;}).join('')}</div>`:'';
  return `${sectionHeading(parent()?'A clear view of their learning.':`Hello, ${s.display_name}.`,parent()?'See the progress. Notice the gaps. Help with the next step.':'Your next small step starts here.')}${family}${dailyPanel()}<section class="hero"><div><span class="eyebrow">${parent()?'Learning, with a little direction':'Make room for a little discovery'}</span><h2 class="serif">A little progress,<br>every day.</h2><p>${parent()?`Keep ${esc(s.display_name)}’s study time realistic, focused, and connected to the next exam.`:'You don’t have to know it all. Start with one idea, one question, one small win.'}</p><button class="btn" data-page="${parent()?'week':'tutor'}">${parent()?'View study plan':'Let’s start learning'} ${icon('arrow')}</button></div><div class="hero-art">${art}</div></section><div class="stats">${stat('Today’s study',m.due.filter(t=>t.status==='done').length,`${m.due.length} planned tasks · completion only`,'check','/ '+m.due.length)}${stat('Portions completed',coverage,`${portion.length} portions in ${state.assessment||'the assessment'}`,'book','/ '+portion.length)}${stat('Practice accuracy',m.accuracy===null?'—':m.accuracy+'%',m.attempts.length?`${m.attempts.length} first answers · help tracked separately`:'Answer practice questions to build evidence','progress')}</div><div class="columns"><section class="card"><div class="card-header"><div><h2>${m.due.length?'Today’s study plan':'Your next study sessions'}</h2><p>${m.due.length?'One focused session at a time.':'A clear starting point for the week.'}</p></div><button class="link-button" data-page="week">Full week ${icon('arrow')}</button></div>${tasks.length?tasks.map(taskHTML).join(''):empty('No study tasks are planned yet.',parent()?'<button class="btn soft small" data-page="settings">Add study availability</button>':'<p>Your parent can help set up your weekly plan.</p>')}</section><div class="stack"><section class="card"><div class="card-header"><div><h2>Coming up</h2><p>Keep the next exam in view.</p></div>${icon('week')}</div>${upcoming.length?upcoming.map(examHTML).join(''):empty('PT2 exam dates: Not announced. We can prepare without inventing dates.')}</section><section class="card"><div class="card-header"><div><h2>A little extra practice</h2><p>Based on answers, not time spent chatting.</p></div>${icon('leaf')}</div>${weak.length?weak.map(w=>`<div class="insight"><h3>${esc(w.lesson.lesson_name)}</h3><p>${esc(w.lesson.subject)} · ${w.accuracy}% correct across ${w.total} answers.</p><button class="link-button" data-lesson-practice="${esc(w.lesson.id)}">Practise this ${icon('arrow')}</button></div>`).join(''):empty('No weak-topic evidence yet. A short practice session is a good starting point.')}</section></div></div>`;
}
function downloadTimetable() {
  const s = currentStudent();
  const tasks = own('tasks').filter(t => t.scheduled_date >= state.week && t.scheduled_date <= addDays(state.week, 6));
  const weekStart = state.week;
  const days = [
    { name: 'Monday', date: weekStart, dayIdx: 0 },
    { name: 'Tuesday', date: addDays(weekStart, 1), dayIdx: 1 },
    { name: 'Wednesday', date: addDays(weekStart, 2), dayIdx: 2 },
    { name: 'Thursday', date: addDays(weekStart, 3), dayIdx: 3 },
    { name: 'Friday', date: addDays(weekStart, 4), dayIdx: 4 }
  ];
  const studentName = s ? s.display_name : 'Student';
  const grade = s ? s.grade : '';

  const rows = [
    {
      time: '6:30 - 7:30',
      cells: days.map(() => 'Wake up, brush/bath, breakfast')
    },
    {
      time: '7:30 - 8:00',
      cells: days.map(() => 'Study or revise')
    },
    {
      time: '8:15 - 3:50',
      cells: days.map(() => 'School')
    },
    {
      time: '3:45 - 4:00',
      cells: [
        'Snack + relax. No screen during snack.',
        'Snack + relax.',
        'Snack + relax.',
        'Snack + relax.',
        'Snack + relax.'
      ]
    },
    {
      time: '4:00 - 5:00',
      cells: days.map(d => {
        const dTasks = tasks.filter(t => t.scheduled_date === d.date && t.start_minute < 1050);
        if (dTasks.length) {
          return dTasks.map(t => '<strong>' + esc(t.subject) + '</strong><br>' + esc(t.topic)).join('<br><br>');
        }
        return 'Study / revision';
      })
    },
    {
      time: '5:00 - 6:45',
      cells: days.map(() => 'Outdoor play / sports')
    },
    {
      time: '6:45 - 7:15',
      cells: days.map(() => 'Quran reading')
    },
    {
      time: '7:15 - 8:00',
      cells: days.map(() => 'Dinner + family time')
    },
    {
      time: '8:00 - 9:00',
      cells: days.map(d => {
        const dTasks = tasks.filter(t => t.scheduled_date === d.date && t.start_minute >= 1050);
        if (dTasks.length) {
          return dTasks.map(t => '<strong>' + esc(t.subject) + '</strong><br>' + esc(t.topic)).join('<br><br>');
        }
        return 'Homework / light revision';
      })
    },
    {
      time: '9:00 - 9:30',
      cells: days.map(() => 'PS4 / free time')
    },
    {
      time: '9:30 - 10:00',
      cells: days.map(() => 'Book reading, lights out by 10:00')
    }
  ];

  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>' + esc(studentName) + ' Weekly Study Timetable</title>' +
    '<style>' +
    '@page { size: landscape; margin: 10mm; }' +
    '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; color: #1e355b; background: #fff; }' +
    '.header { text-align: center; margin-bottom: 14px; }' +
    'h1 { color: #205c9e; margin: 0 0 6px 0; font-size: 26px; font-weight: 800; }' +
    '.subtitle { font-size: 13px; color: #4e6074; margin: 0; }' +
    'table { width: 100%; border-collapse: collapse; border: 2px solid #5a94cf; font-size: 11px; margin-top: 10px; }' +
    'th { background-color: #4b8cd4; color: #ffffff; padding: 10px 8px; text-align: center; font-size: 12px; font-weight: 700; border: 1px solid #7eb1e8; }' +
    'th:first-child { width: 105px; }' +
    'td { padding: 7px 8px; border: 1px solid #d9e6f3; vertical-align: middle; text-align: center; line-height: 1.35; font-size: 11px; }' +
    'tr:nth-child(even) td { background-color: #fbfbf9; }' +
    'tr:nth-child(odd) td { background-color: #f6faff; }' +
    'td.time-col { background-color: #e9f2fb !important; font-weight: 700; color: #1e5a9c; text-align: center; border-right: 2px solid #5a94cf; }' +
    'td strong { color: #1e5a9c; font-size: 11px; display: inline-block; margin-bottom: 2px; }' +
    '.footer { margin-top: 12px; font-size: 11px; color: #556980; }' +
    '.actions { text-align: right; margin-bottom: 12px; }' +
    '.btn-print { background: #1e5a9c; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; }' +
    '@media print { .actions { display: none; } body { padding: 0; } }' +
    '</style></head><body>' +
    '<div class="actions"><button class="btn-print" onclick="window.print()">Print / Save as PDF</button></div>' +
    '<div class="header">' +
    '<h1>' + esc(studentName) + ' Weekly Study Timetable</h1>' +
    '<p class="subtitle">Balanced plan: school, morning revision, subject portions, Quran, play, reading, and rest · ' + esc(grade) + ' · Week of ' + esc(shortDate(weekStart)) + '</p>' +
    '</div>' +
    '<table><thead><tr><th>Time</th>' +
    days.map(d => '<th>' + d.name + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(r => '<tr><td class="time-col">' + esc(r.time) + '</td>' + r.cells.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>' +
    '<div class="footer">Study method: 25 minutes focus + 5 minutes break. Keep phone/PS4 away during study blocks. Tick completed items daily.</div>' +
    '</body></html>';

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = (studentName || 'weekly').toLowerCase() + '-study-timetable.html';
    a.click();
  }
}

function weekView() {
  const plan=own('plans').find(p=>p.week_start===state.week), tasks=own('tasks').filter(t=>t.scheduled_date>=state.week&&t.scheduled_date<=addDays(state.week,6));
  const warnings=Array.isArray(plan?.warnings)?plan.warnings:[];
  return `${sectionHeading('A balanced week.','One coordinated plan across subjects, with space to practise and rest.')}<section class="card"><form id="plan-form" class="toolbar"><div class="field"><label for="assessment">Assessment portions</label><select id="assessment" name="assessment" data-select="assessment" required>${assessmentOptions()||'<option value="">No curriculum imported</option>'}</select></div><div class="field"><label for="week-start">Week beginning · Monday</label><input id="week-start" name="week_start" type="date" value="${esc(state.week)}" data-select="week" required></div>${parent()?`<button class="btn" type="submit"${!lessons().length?' disabled':''}>${icon('week')}${plan?'Update future sessions':'Create weekly plan'}</button>`:''}<button class="btn soft" type="button" data-action="download-timetable">${icon('external')} Download timetable</button></form>${parent()?'<p class="small muted">Uses saved availability, exam dates, subject priorities and practice results. Completed work and past sessions are preserved. Updates apply when you regenerate the week.</p>':''}${plan?`<p class="small muted">Saved plan: ${esc(plan.assessment)} · revision ${plan.revision} · ${tasks.reduce((n,t)=>n+t.planned_minutes,0)} study minutes this week.</p>`:''}${warnings.length?`<div class="notice"><strong>Things to keep in mind</strong><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}${tasks.length?`<div class="week-grid">${Array.from({length:7},(_,i)=>{const date=addDays(state.week,i),daily=tasks.filter(t=>t.scheduled_date===date);return `<section class="day-column"><div class="day-title ${date===state.data.today?'today':''}">${new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'})}<span>${new Date(date+'T12:00:00Z').getUTCDate()}</span></div>${daily.length?daily.map(t=>`<article class="week-task ${t.status==='done'?'done':''}"><span class="pill">${esc(t.subject)}</span><h3>${esc(t.topic)}</h3><p>${minutes(t.start_minute)} · ${t.planned_minutes} min</p><p>${esc(t.activity)}</p>${t.status==='done'?'<span class="pill gray">Completed</span>':`<button class="link-button" data-start-task="${esc(t.id)}">Open ${icon('arrow')}</button>`}</article>`).join(''):'<div class="rest-day">No study session<br>planned</div>'}</section>`;}).join('')}</div>`:empty(parent()?'Choose an assessment, save availability, then create this week’s plan.':'Your weekly plan will appear here when your parent creates it.')}</section>`;
}
function lessonFilters() {
  const list=lessons().filter(l=>!state.subject||l.subject===state.subject);
  return `<div class="filter-row"><div class="field"><label for="subject-filter">Subject</label><select id="subject-filter" data-select="subject">${option('','All subjects',!state.subject)}${subjects().map(s=>option(s,s,state.subject===s)).join('')}</select></div><div class="field"><label for="lesson-filter">Lesson</label><select id="lesson-filter" data-select="lesson">${option('','Choose a lesson',!state.lessonId)}${list.map(l=>option(l.id,`${l.lesson_name}${state.subject?'':' · '+l.subject}`,state.lessonId===l.id)).join('')}</select></div></div>`;
}
function tutorView() {
  const lesson=currentLesson(), conversations=own('conversations').filter(c=>!lesson||c.lesson_id===lesson.id).slice(0,8);
  const enabled=state.data.aiEnabled && lesson && !state.readOnlyConversation;
  return `${sectionHeading('Good questions lead somewhere.','Explore a lesson, untangle an idea, or ask for a different explanation.')}${lessonFilters()}<div class="chat-layout"><section class="card chat-card"><div class="chat-heading"><h2>${lesson?esc(lesson.lesson_name):'Your learning companion'}</h2><p>${lesson?esc(lesson.subject)+' · '+esc(state.assessment):'Choose a subject and lesson to begin.'}</p></div><div class="chat-messages" id="chat-messages" aria-live="polite">${chatMessages()}</div><form id="tutor-form" class="chat-compose">${!state.data.aiEnabled?'<div class="notice info">The tutor connection is being prepared. Your study plan and saved practice are available.</div>':''}${state.readOnlyConversation?'<div class="notice info">You’re viewing a saved conversation. Start a new conversation to ask your own question.</div>':''}<label class="sr-only" for="tutor-message">Your question</label><textarea id="tutor-message" name="message" rows="2" maxlength="3000" placeholder="What would you like to understand?" required${!enabled||state.sending?' disabled':''}></textarea><div class="between"><p>Ask freely. Check important answers with your school material.</p><button class="btn small" type="submit"${!enabled||state.sending?' disabled':''}>${state.sending?'Thinking…':'Ask tutor'} ${icon('send')}</button></div></form></section><aside class="stack chat-side"><section class="card"><h3>${icon('leaf')} Try a small step</h3><p>“Explain this with an example.”</p><p>“Give me a hint.”</p><p>“Ask me a question to check I understand.”</p><button class="link-button" data-action="new-chat">Start a new conversation ${icon('plus')}</button></section><section class="card"><h3>Saved conversations</h3>${conversations.length?conversations.map(c=>`<button class="history-item" data-conversation="${esc(c.id)}">${esc(lessons().find(l=>l.id===c.lesson_id)?.lesson_name||'Saved lesson')}<br><span class="small muted">${esc(shortDate(c.created_at.slice(0,10)))}${c.author_id!==state.data.profile.id?' · child conversation':''}</span></button>`).join(''):'<p>Your questions and explanations will be saved here after a tutor session.</p>'}</section></aside></div>`;
}
function chatMessages() {
  return state.messages.length?state.messages.map(m=>`<div class="bubble ${m.role==='user'?'user':''}"><small>${m.role==='user'?'Question':'Tutor'}</small>${esc(m.content)}</div>`).join(''):`<div class="chat-empty"><div class="tutor-symbol">${icon('tutor')}</div><h3>Let’s make it make sense.</h3><p>Choose a lesson, then bring a question.<br>We’ll take it one idea at a time.</p></div>`;
}
function practiceView(){return learningPracticeView();}
function materialsView() {
  const list=own('materials').filter(m=>!state.subject||m.subject===state.subject).filter(m=>!m.assessment||m.assessment===state.assessment);
  return `${uploadPanel()}${sectionHeading('The school material, together.','Keep worksheets, notes and revision connected to what you’re learning.')}<div class="toolbar"><div class="field"><label for="material-subject">Subject</label><select id="material-subject" data-select="subject">${option('','All subjects',!state.subject)}${[...new Set(own('materials').map(m=>m.subject))].sort().map(s=>option(s,s,state.subject===s)).join('')}</select></div><div class="field"><label for="material-assessment">Assessment</label><select id="material-assessment" data-select="assessment">${assessmentOptions()}</select></div></div>${list.length?`<div class="material-grid">${list.map(m=>`<article class="card material-card"><div class="between"><div class="material-icon">${icon('book')}</div><span class="pill gray">${esc(m.subject)}</span></div><h3>${esc(m.title)}</h3><p>${esc(m.summary?.slice(0,180)||m.lesson_name||'School material · stored in your Google Drive.')}</p>${m.object_path?`<a class="link-button" href="/api/material/file?id=${encodeURIComponent(m.id)}">Download school file ${icon('external')}</a>`:m.drive_file_id?`<a class="link-button" href="https://drive.google.com/file/d/${encodeURIComponent(m.drive_file_id)}/view" target="_blank" rel="noopener noreferrer">Open school material ${icon('external')}</a>`:''}<span class="pill ${m.processing_status==='ready'?'':'orange'}">${m.processing_status==='ready'?'Reviewed text ready':m.processing_status==='needs_text'?'Needs readable text':'Text review needed'}</span><button class="link-button" data-edit-text="${esc(m.id)}">Review / add text</button></article>`).join('')}</div>`:empty('No school materials are linked to this selection yet.')}<div class="notice info small">New school files are saved in the private family store. Existing Drive materials keep their original permissions. Exact file content or Drive IDs identify duplicates, not filenames.</div>`;
}
function weakLessons() {
  return lessons().map(lesson=>{const qids=new Set(own('questions').filter(q=>q.lesson_id===lesson.id).map(q=>q.id));const attempts=own('attempts').filter(a=>qids.has(a.question_id)&&typeof a.correct==='boolean');return {lesson,total:attempts.length,accuracy:attempts.length?Math.round(100*attempts.filter(a=>a.correct).length/attempts.length):null};}).filter(x=>x.total&&x.accuracy<70).sort((a,b)=>a.accuracy-b.accuracy);
}
function progressView() {
  const all=lessons(), attempts=own('attempts'), questions=own('questions'), done=own('tasks').filter(t=>t.status==='done');
  const report=subjects().map(subject=>{const portions=all.filter(l=>l.subject===subject),ids=new Set(portions.map(l=>l.id)),qids=new Set(questions.filter(q=>ids.has(q.lesson_id)).map(q=>q.id)),answers=attempts.filter(a=>qids.has(a.question_id)&&typeof a.correct==='boolean');return {subject,total:portions.length,done:portions.filter(l=>done.some(t=>t.lesson_id===l.id)).length,answers:answers.length,independent:answers.filter(a=>!a.assisted).length,accuracy:answers.length?Math.round(100*answers.filter(a=>a.correct).length/answers.length):null};});
  const weak=weakLessons();
  return `${sectionHeading('See the learning, not just the activity.','Task completion, portion coverage and practice results each tell a different story.')}<section class="card"><div class="card-header"><div><h2>Assessment progress</h2><p>${esc(state.assessment)} · First submitted answers. Accuracy is not an exam-readiness prediction.</p></div></div>${report.length?`<div class="table-wrap"><table><thead><tr><th>Subject</th><th>Portions completed</th><th>Practice answers</th><th>Without recent tutor help</th><th>Accuracy</th></tr></thead><tbody>${report.map(r=>`<tr><td><strong>${esc(r.subject)}</strong></td><td>${r.done} / ${r.total}<progress max="${r.total||1}" value="${r.done}" aria-label="${esc(r.subject)} portion completion"></progress></td><td>${r.answers||'—'}</td><td>${r.independent||'—'}</td><td><span class="pill ${r.accuracy!==null&&r.accuracy<70?'orange':'gray'}">${r.accuracy===null?'No evidence yet':r.accuracy+'%'}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Curriculum portions have not been imported yet.')}</section><div class="columns details-form"><section class="card"><h2>Where to focus next</h2>${weak.length?weak.map(w=>`<div class="insight"><h3>${esc(w.lesson.lesson_name)}</h3><p>${esc(w.lesson.subject)} · ${w.accuracy}% across ${w.total} answers${w.total<3?' · Early evidence; more practice is needed.':'.'}</p><button class="link-button" data-lesson-practice="${esc(w.lesson.id)}">Open practice ${icon('arrow')}</button></div>`).join(''):empty('There is not enough evidence to identify a weak topic yet.')}</section><section class="card"><h2>Recent practice</h2>${attempts.length?attempts.slice(0,12).map(a=>{const q=questions.find(q=>q.id===a.question_id),l=state.data.curriculum.find(l=>l.id===q?.lesson_id);return `<div class="exam-item"><span class="pill ${a.correct?'':'orange'}">${a.review_status==='review_pending'?'Awaiting parent':a.correct?'Correct':'Review'}</span><div><h3>${esc(l?.lesson_name||'Practice question')}</h3><p>${esc(shortDate(a.submitted_at.slice(0,10)))}${a.assisted?' · With tutor support':''}</p></div></div>`;}).join(''):empty('Saved practice results will appear here.')}</section></div>${own('legacy').length?`<div class="notice info">${own('legacy').length} historical records were preserved during migration. They are kept separate from new practice accuracy because their marking rules may differ.</div>`:''}<p class="small muted">“Without recent tutor help” means no saved tutor explanation for that lesson in the preceding 30 minutes. It does not measure help outside this app.</p>`;
}
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function slotRow(slot={day:0,start_minute:960,end_minute:990,fixed_activity:'',can_study:true}) {
  return `<div class="slot-row"><select data-slot="day" aria-label="Day">${days.map((d,i)=>option(i,d,i===slot.day)).join('')}</select><input data-slot="start" type="time" value="${minutes(slot.start_minute)}" aria-label="Start time" required><input data-slot="end" type="time" value="${minutes(slot.end_minute)}" aria-label="End time" required><input data-slot="fixed_activity" value="${esc(slot.fixed_activity)}" maxlength="200" placeholder="Activity (optional)" aria-label="Activity"><select data-slot="can_study" aria-label="Time type">${option('true','Study time',slot.can_study)}${option('false','Fixed activity',!slot.can_study)}</select><button class="icon-button" type="button" data-action="remove-slot" aria-label="Remove slot">${icon('close')}</button></div>`;
}
function settingsView() {
  if(!parent()) return empty('These controls are available in the parent account.');
  const s=currentStudent(), exams=own('exams');
  return `${sectionHeading('Make the plan fit real life.','Set available time, exam dates and a little extra focus where it’s needed.')}<div class="settings-grid"><section class="card wide-card"><div class="card-header"><div><h2>Weekly availability</h2><p>Use UAE time. Include school, sports and other fixed commitments if helpful. Slots cannot overlap.</p></div></div><form id="availability-form"><div class="slot-head"><span>Day</span><span>From</span><span>To</span><span>Activity</span><span>Time type</span></div><div id="slots">${own('availability').map(slotRow).join('')}</div><div class="between"><button class="link-button" type="button" data-action="add-slot">${icon('plus')} Add a time slot</button><button class="btn small" type="submit">Save availability ${icon('check')}</button></div></form></section><section class="card"><h2>Study preferences</h2><form id="preferences-form"><div class="field"><label for="focus-minutes">Focus session length <span class="optional">· minutes</span></label><input id="focus-minutes" name="focus_minutes" type="number" min="5" max="50" value="${s.attention_span_minutes}" required></div><p class="small muted">The planner adds a five-minute break between sessions. It may shorten a session to fit a slot.</p>${subjects().map(subject=>`<label class="priority-row"><span>${esc(subject)}</span><select data-priority="${esc(subject)}" aria-label="${esc(subject)} priority">${[1,2,3].map((n,i)=>option(n,['Balanced','Extra focus','High priority'][i],(s.subject_priorities?.[subject]||1)===n)).join('')}</select></label>`).join('')}<button class="btn small" type="submit">Save preferences ${icon('check')}</button></form></section><section class="card"><h2>Exam dates</h2><p class="small muted">Add a subject date for precise planning, or an assessment window if individual dates are not known.</p><form id="exam-form"><input type="hidden" name="id"><div class="field"><label for="exam-assessment">Assessment</label><select id="exam-assessment" name="assessment" data-select="exam-assessment" required>${assessmentOptions()}</select></div><div class="field"><label for="exam-subject">Subject or assessment window</label><select id="exam-subject" name="subject">${option('','Whole assessment window')}${subjects().map(s=>option(s,s)).join('')}</select></div><div class="form-pair"><div class="field"><label for="exam-start">Start / exam date</label><input id="exam-start" name="start_date" type="date" required></div><div class="field"><label for="exam-end">End date</label><input id="exam-end" name="end_date" type="date" required></div></div><button class="btn small" type="submit">Save exam ${icon('check')}</button><button class="link-button" type="reset">Clear form</button></form><div class="details-form">${exams.length?exams.map(e=>`<div class="exam-item"><div class="grow"><h3>${esc(e.subject||'Assessment window')} · ${esc(e.assessment)}</h3><p>${esc(shortDate(e.start_date))} – ${esc(shortDate(e.end_date))}</p></div><button class="link-button" data-edit-exam="${esc(e.id)}">Edit</button></div>`).join(''):'<p class="small muted">No exam dates saved yet.</p>'}</div></section></div><div class="notice info details-form">After changing dates, priorities or availability, update the weekly plan to apply the changes. Completed work stays in the history.</div>`;
}
const views={overview,portions:portionsView,study:studyView,week:weekView,tutor:tutorView,practice:practiceView,materials:materialsView,progress:progressView,settings:settingsView};

document.addEventListener('click', async event=>{
  const b=event.target.closest('button'); if(!b) return;
  if(b.dataset.page) { state.page=b.dataset.page; renderApp(); window.scrollTo(0,0); return; }
  if(b.dataset.student) { if(state.timerId)await heartbeat(true);loadVersion++;state.studentId=b.dataset.student; state.assessment=''; resetLesson(); syncSelection(); renderApp(); return; }
  if(b.dataset.startTask) { if(state.timerId)await heartbeat(true);const t=own('tasks').find(t=>t.id===b.dataset.startTask); if(!t)return;state.page='tutor';state.assessment=t.assessment;resetLesson();state.lessonId=t.lesson_id;state.subject=t.subject;renderApp();return; }
  if(b.dataset.lessonPractice) { const l=lessons().find(l=>l.id===b.dataset.lessonPractice);if(!l)return;resetLesson();state.lessonId=l.id;state.subject=l.subject;state.page='practice';renderApp();return; }
  if(b.dataset.editExam) { const e=own('exams').find(e=>e.id===b.dataset.editExam);if(!e)return;const f=$('#exam-form');f.elements.id.value=e.id;f.elements.assessment.value=e.assessment;updateExamSubjects(e.assessment);f.elements.subject.value=e.subject;f.elements.start_date.value=e.start_date;f.elements.end_date.value=e.end_date;f.scrollIntoView({block:'center'});return; }
  if(b.dataset.action==='add-slot') { $('#slots').insertAdjacentHTML('beforeend',slotRow());return; }
  if(b.dataset.action==='remove-slot') { b.closest('.slot-row').remove();return; }
  if(b.dataset.action==='download-timetable') { downloadTimetable(); return; }
  if(b.dataset.action==='new-chat') { loadVersion++;state.messages=[];state.conversationId=null;state.readOnlyConversation=false;renderApp();return; }
  b.disabled=true;
  try {
    if(b.dataset.selectProfile){if(preview){state.data=sampleData(b.dataset.selectProfile==='parent'?'parent':'child');state.data.students=state.familySession.students;const chosen=state.familySession.students.find(s=>s.id===b.dataset.selectProfile);if(chosen){state.data.profile={id:'demo-owner',role:'child',display_name:chosen.display_name,student_id:chosen.id};state.data.students=[chosen];}state.studentId=chosen?.id||null;resetLesson();syncSelection();renderApp();return;}await api('profile',{profile_id:b.dataset.selectProfile});resetLesson();state.studentId=null;state.timerId=null;await reload();return;}
    if(b.dataset.action==='choose-profile'){if(state.timerId){state.timerPaused=true;await heartbeat(false);}profilePicker(state.familySession);return;}
    if(b.dataset.action==='logout') { if(preview){location.href='/';return;}await api('logout',{});state.data=null;loginView(); }
    else if(b.dataset.review) { state.results[b.dataset.review]=await api('feedback?id='+encodeURIComponent(b.dataset.review));renderApp(); }
    else if(b.dataset.complete) { await api('complete',{task_id:b.dataset.complete});await reload();notify('Task completed. Practice results track understanding separately.'); }
    else if(b.dataset.action==='generate-quiz') { await api('quiz',{student_id:currentStudent().id,lesson_id:state.lessonId});await reload();notify('Three practice questions are ready.'); }
    else if(b.dataset.conversation) {
      const version=++loadVersion;
      const result=preview?{conversation:own('conversations').find(c=>c.id===b.dataset.conversation),messages:[]}:await api('conversation?id='+encodeURIComponent(b.dataset.conversation));
      if(version!==loadVersion)return;
      const l=state.data.curriculum.find(l=>l.id===result.conversation.lesson_id);state.assessment=l?.assessment||state.assessment;state.lessonId=l?.id||'';state.subject=l?.subject||'';state.conversationId=result.conversation.id;state.messages=result.messages;state.readOnlyConversation=result.conversation.author_id!==state.data.profile.id;renderApp();
    }
  } catch(e) { notify(e.message,true); } finally { b.disabled=false; }
});
function updateExamSubjects(code) { const s=currentStudent();$('#exam-subject').innerHTML=option('','Whole assessment window')+[...new Set(state.data.curriculum.filter(c=>c.grade===s.grade&&c.assessment===code).map(c=>c.subject))].sort().map(x=>option(x,x)).join(''); }
document.addEventListener('change',async event=>{
  const el=event.target, kind=el.dataset.select; if(!kind)return;
  if(kind==='exam-assessment'){updateExamSubjects(el.value);return;}
  if(state.timerId&&['lesson','subject','assessment'].includes(kind))await heartbeat(true);
  loadVersion++;
  if(kind==='assessment'){state.assessment=el.value;resetLesson();}
  if(kind==='subject'){state.subject=el.value;state.lessonId='';state.messages=[];state.conversationId=null;state.readOnlyConversation=false;}
  if(kind==='lesson'){state.lessonId=el.value;state.messages=[];state.conversationId=null;state.readOnlyConversation=false;}
  if(kind==='week'){if(!/^\d{4}-\d{2}-\d{2}$/.test(el.value)){notify('Choose a valid date.',true);return;}state.week=monday(el.value);if(state.week!==el.value)notify('The week begins on Monday, '+shortDate(state.week)+'.');}
  renderApp();
});
document.addEventListener('submit',async event=>{
  const f=event.target;if(!(f instanceof HTMLFormElement)||!['login-form','plan-form','availability-form','preferences-form','exam-form','question-form','tutor-form'].includes(f.id)&&!f.dataset.answerForm)return;event.preventDefault();
  const btn=$('button[type="submit"]',f); if(btn?.disabled)return;if(btn)btn.disabled=true;
  const values=Object.fromEntries(new FormData(f));
  try {
    if(f.id==='login-form') { $('#login-error').textContent='';await api('login',values);await reload();return; }
    if(f.id==='plan-form'){await api('plan',{...values,student_id:currentStudent().id});await reload();notify('Your weekly plan is saved. Check the planning notes for any gaps.');}
    if(f.id==='availability-form') {
      const toMinute=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;};
      const slots=$$('.slot-row',f).map(row=>{const get=k=>$(`[data-slot="${k}"]`,row).value;return {day:+get('day'),start_minute:toMinute(get('start')),end_minute:toMinute(get('end')),fixed_activity:get('fixed_activity'),can_study:get('can_study')==='true'};});
      const result=await api('availability',{student_id:currentStudent().id,slots});await reload();notify(result.message);
    }
    if(f.id==='preferences-form'){const priorities=Object.fromEntries($$('[data-priority]',f).map(el=>[el.dataset.priority,+el.value]));const result=await api('preferences',{student_id:currentStudent().id,focus_minutes:+values.focus_minutes,priorities});await reload();notify(result.message);}
    if(f.id==='exam-form'){const result=await api('exam',{...values,student_id:currentStudent().id});await reload();notify(result.message);}
    if(f.id==='question-form'){await api('question',{...values,student_id:currentStudent().id,lesson_id:state.lessonId,choices:values.choices.split('\n').map(s=>s.trim()).filter(Boolean),correct_index:+values.correct_index});await reload();notify('Practice question assigned.');}
    if(f.dataset.answerForm){const previous=own('attempts').find(a=>a.question_id===f.dataset.answerForm);const result=await api('answer',{question_id:f.dataset.answerForm,chosen_index:previous?previous.chosen_index:+values.choice});state.results[f.dataset.answerForm]=result;await reload();}
    if(f.id==='tutor-form') {
      if(state.sending)return;state.sending=true;
      const studentId=currentStudent().id,lessonId=state.lessonId,version=++loadVersion;
      const result=await api('tutor',{student_id:studentId,lesson_id:lessonId,conversation_id:state.conversationId,message:values.message});
      if(version===loadVersion && currentStudent()?.id===studentId && state.lessonId===lessonId) {
        state.messages.push({role:'user',content:values.message},{role:'assistant',content:result.text});state.conversationId=result.conversation_id;await reload(false);state.sending=false;renderApp();$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
      }
    }
  } catch(e){if(f.id==='login-form'&&$('#login-error'))$('#login-error').textContent=e.message;else notify(e.message,true);}
  finally {state.sending=false;if(btn)btn.disabled=false;}
});

async function init() {
  if(preview){state.data=sampleData(new URLSearchParams(location.search).get('view')==='child'?'child':'parent');state.familySession={students:[...state.data.students],choices:[{id:'parent',name:'Parent',role:'parent'},...state.data.students.map(s=>({id:s.id,name:s.display_name,grade:s.grade,role:'child'}))]};syncSelection();renderApp();return;}
  try { await reload(); }
  catch(e) { if(!state.data)loginView(e.message==='Please sign in to continue.'?'':e.message); }
}
configureLearningUI({state,api,reload,preview,notify,render:renderApp,esc,student:currentStudent,parent,lessons,heading:sectionHeading,filters:lessonFilters,empty});
init();
export { state, views, renderApp, loginView, esc, syncSelection };
