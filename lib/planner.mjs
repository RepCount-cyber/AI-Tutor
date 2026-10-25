import { addDays, monday, todayDubai, validDate } from './dates.mjs';
import { requireValue } from './errors.mjs';

export function validateSlots(slots) {
  requireValue(Array.isArray(slots) && slots.length <= 100, 'Provide up to 100 availability slots.');
  const clean = slots.map(s => {
    requireValue([s.day, s.start_minute, s.end_minute].every(Number.isInteger) && s.day >= 0 && s.day <= 6 && s.start_minute >= 0 && s.end_minute <= 1440 && s.end_minute > s.start_minute, 'Invalid study slot.');
    requireValue(typeof s.can_study === 'boolean', 'Choose study time or fixed activity.');
    return { day: s.day, start_minute: s.start_minute, end_minute: s.end_minute, can_study: s.can_study, fixed_activity: String(s.fixed_activity || '').slice(0, 200) };
  }).sort((a, b) => a.day - b.day || a.start_minute - b.start_minute);
  for (let i = 1; i < clean.length; i++) requireValue(clean[i].day !== clean[i - 1].day || clean[i].start_minute >= clean[i - 1].end_minute, 'Availability slots must not overlap, including fixed activities.');
  return clean;
}
export function lessonEvidence(lessonId, questions, attempts) {
  const ids = new Set(questions.filter(q => q.lesson_id === lessonId).map(q => q.id));
  const relevant = attempts.filter(a => ids.has(a.question_id)&&typeof a.correct==='boolean');
  const independent = relevant.filter(a => !a.assisted);
  return { total: relevant.length, correct: relevant.filter(a => a.correct).length, independent: independent.length,
    accuracy: relevant.length ? Math.round(100 * relevant.filter(a => a.correct).length / relevant.length) : null,
    latest: relevant.map(a => a.submitted_at?.slice(0, 10)).filter(Boolean).sort().at(-1) || null };
}
export function buildPlan({ student, assessment, weekStart, curriculum = [], availability = [], exams = [], tasks = [], questions = [], attempts = [], materials = [], legacy = [], checkins = [], today = todayDubai(), nowMinute = 0 }) {
  requireValue(validDate(weekStart) && monday(weekStart) === weekStart, 'Choose a Monday for the start of the week.');
  requireValue(weekStart >= monday(today) && weekStart <= addDays(today, 60), 'Choose this week or a week within the next 60 days.');
  const lessons = curriculum.filter(c => c.grade === student.grade && c.assessment === assessment && c.status === 'active');
  requireValue(lessons.length, 'No active curriculum portions were found for this assessment. Import the curriculum first.');
  const slots = validateSlots(availability.filter(a => a.student_id === student.id));
  const preserved = tasks.filter(t => t.student_id === student.id && t.scheduled_date >= weekStart && t.scheduled_date <= addDays(weekStart, 6)
    && (t.status !== 'planned' || t.scheduled_date < today || (t.scheduled_date === today && t.start_minute < nowMinute)));
  const relevantExams = exams.filter(e => e.student_id === student.id && e.assessment === assessment);
  const attendedOrCurrent = preserved.filter(t => t.status === 'done' || (t.status === 'planned' && t.scheduled_date >= today));
  const missed = preserved.filter(t => t.status === 'planned' && t.scheduled_date < today);
  const counts = new Map(lessons.map(l => [l.id, attendedOrCurrent.filter(t => t.lesson_id === l.id).length]));
  const subjectMinutes = new Map();
  for (const t of attendedOrCurrent) subjectMinutes.set(t.subject, (subjectMinutes.get(t.subject) || 0) + t.planned_minutes);
  const evidence = new Map(lessons.map(l => [l.id, lessonEvidence(l.id, questions, attempts)]));
  const sessions = [], warnings = [];
  const chunk = Math.min(50, Math.max(5, student.attention_span_minutes || 25));
  if (missed.length) warnings.push(`${missed.length} missed sessions were kept in history. Their lessons are prioritised again in the remaining study slots.`);
  if (!slots.some(s => s.can_study)) warnings.push('No study availability is saved. Add available time before generating a plan.');
  if (!relevantExams.length) warnings.push('Exam dates are missing. This plan balances coverage without an exam deadline.');
  if (relevantExams.some(e => !e.subject)) warnings.push('An assessment date window is present. Add subject exam dates for more precise scheduling; undated subjects are planned before the window starts.');
  for (let day = 0; day < 7; day++) {
    const date = addDays(weekStart, day);
    if (date < today) continue;
    const dayLessons = new Set(preserved.filter(t => t.scheduled_date === date).map(t => t.lesson_id));
    const blockers = preserved.filter(t => t.scheduled_date === date);
    for (const slot of slots.filter(s => s.day === day && s.can_study)) {
      let cursor = Math.max(slot.start_minute, date === today ? Math.ceil(nowMinute / 5) * 5 : 0);
      while (cursor + 5 <= slot.end_minute && sessions.length < 100) {
        const blocking = blockers.find(t => cursor < t.start_minute + t.planned_minutes + 5 && cursor + 5 > t.start_minute);
        if (blocking) { cursor = blocking.start_minute + blocking.planned_minutes + 5; continue; }
        const nextBlock = blockers.filter(t => t.start_minute > cursor).sort((a, b) => a.start_minute - b.start_minute)[0];
        const length = Math.min(chunk, slot.end_minute - cursor, nextBlock ? nextBlock.start_minute - cursor - 5 : Infinity);
        if (length < 5) { cursor = nextBlock ? nextBlock.start_minute + nextBlock.planned_minutes + 5 : slot.end_minute; continue; }
        const candidates = lessons.filter(l => {
          if (dayLessons.has(l.id)) return false;
          const subjectDates = relevantExams.filter(e => e.subject === l.subject);
          const dates = (subjectDates.length ? subjectDates : relevantExams.filter(e => !e.subject)).map(e => e.start_date).sort();
          return !dates.length || date < dates[0];
        }).map(l => {
          const ev = evidence.get(l.id), repeats = counts.get(l.id) || 0;
          const historicalFlag = legacy.some(r => r.student_id === student.id && ['WeakAreas','Weak_Areas'].includes(r.source_tab)
            && r.data?.subject === l.subject && (r.data?.topic || r.data?.lesson_name) === l.lesson_name);
          const weakBoost = ev.total && ev.accuracy < 70 ? 1.7 : historicalFlag && ev.total < 3 ? 1.4 : 1;
          const priority = Number(student.subject_priorities?.[l.subject]) || 1;
          const exam = relevantExams.filter(e => e.subject === l.subject || !e.subject).map(e => e.start_date).sort()[0];
          const days = exam ? Math.max(1, Math.round((new Date(exam) - new Date(date)) / 86400000)) : 60;
          const dueBoost = ev.latest && ev.latest <= addDays(date, -3) ? 1.15 : 1;
          // Uncovered lessons get a strong first pass; weak topics then receive extra practice.
          const missedBoost = missed.some(t => t.lesson_id === l.id) ? 1.3 : 1;
          const requestedHelp=checkins.some(c=>c.student_id===student.id&&c.lesson_id===l.id&&c.needs_help&&c.study_date>=addDays(date,-7));
          const score = (repeats ? 1 : 4) * weakBoost * missedBoost * (requestedHelp?1.4:1) * Math.min(3, priority) * dueBoost * (1 + 7 / days)
            / (1 + (subjectMinutes.get(l.subject) || 0) / (chunk * 2)) / (1 + repeats);
          return { l, score, repeats, ev };
        }).sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id));
        if (!candidates.length) break;
        const { l, repeats, ev } = candidates[0];
        const activity = ev.total && ev.accuracy < 70 ? 'Review mistakes and practise with hints' : repeats ? 'Recall, practise and check understanding' : 'Study the material and explain the idea';
        sessions.push({ lesson_id: l.id, scheduled_date: date, start_minute: cursor, planned_minutes: length, activity });
        counts.set(l.id, repeats + 1); subjectMinutes.set(l.subject, (subjectMinutes.get(l.subject) || 0) + length); dayLessons.add(l.id);
        cursor += length + 5;
      }
    }
  }
  const uncovered = lessons.filter(l => !counts.get(l.id));
  if (uncovered.length) warnings.push(`${uncovered.length} of ${lessons.length} portions have no session in this week. Review available time and exam priorities.`);
  const missingMaterials = lessons.filter(l => !materials.some(m => m.student_id === student.id && m.subject === l.subject && (!m.assessment || m.assessment === assessment) && (!m.lesson_name || m.lesson_name === l.lesson_name)));
  if (missingMaterials.length) warnings.push(`${missingMaterials.length} portions have no matching school material. Curriculum objectives are used; no document references are invented.`);
  if (!sessions.length && slots.some(s => s.can_study)) warnings.push('No new sessions fit the remaining availability and exam dates. Existing completed and past sessions were preserved.');
  const required = lessons.reduce((sum, l) => sum + (Number(l.estimated_hours) > 0 ? Number(l.estimated_hours) * 60 : chunk * 2), 0);
  const planned = sessions.reduce((sum, s) => sum + s.planned_minutes, 0) + attendedOrCurrent.reduce((sum, t) => sum + t.planned_minutes, 0);
  if (planned < required) warnings.push(`Planned study time is ${planned} minutes; the estimated learning workload is ${Math.round(required)} minutes across the assessment. Remaining weeks may be needed.`);
  for(let day=5;day<=6;day++){const date=addDays(weekStart,day),target=Number(student.daily_targets?.[day])||0;if(target&&date>=today){const actual=sessions.filter(s=>s.scheduled_date===date).reduce((n,s)=>n+s.planned_minutes,0)+attendedOrCurrent.filter(t=>t.scheduled_date===date).reduce((n,t)=>n+t.planned_minutes,0);if(actual<target)warnings.push(`${date}: ${actual} study minutes fit the plan against the ${target}-minute target. Review remaining portions, availability and exam dates.`);}}
  return { sessions, warnings, preservedCount: preserved.length, coverage: { total: lessons.length, scheduled: lessons.length - uncovered.length }, minutes: planned };
}
