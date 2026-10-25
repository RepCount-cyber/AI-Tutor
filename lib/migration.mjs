import { createHash } from 'node:crypto';
import { requireValue } from './errors.mjs';
import { minutes, validDate } from './dates.mjs';
import { validateSlots } from './planner.mjs';

const str = v => v === undefined || v === null ? '' : String(v).trim();
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
export const canonicalGrade = value => /^\d+$/.test(str(value).replace(/^grade\s*/i,'')) ? 'Grade ' + +str(value).replace(/^grade\s*/i,'') : str(value);
function active(value) { return !str(value) || str(value).toLowerCase() === 'active'; }
function need(value,label) { requireValue(str(value), `Missing ${label}.`); return str(value); }
function optionalNumber(value,label,minimum,maximum) {
  if (!str(value)) return null;
  const n=Number(value);requireValue(Number.isFinite(n) && n>=minimum && n<=maximum, `Invalid ${label}: ${str(value)}.`);return n;
}
export function transformSheets(sheets, { expandSharedExams = false } = {}) {
  const output={students:[],assessments:[],curriculum:[],exams:[],availability:[],materials:[],legacy_records:[]};
  const warnings=[], failures=[];
  const run=(tab,fn)=>(sheets[tab]||[]).forEach((row,i)=>{try{fn(row,i);}catch(e){failures.push(`${tab} row ${i+2}: ${e.message}`);}});
  run('Students', r=>{
    if (!active(r.status)) { warnings.push(`Inactive student ${str(r.student_id)} skipped.`); return; }
    const focus=optionalNumber(r.attention_span_minutes,'attention span',5,50) ?? 25;
    requireValue(Number.isInteger(focus),'Attention span must be whole minutes.');
    const age=optionalNumber(r.age,'age',3,22);requireValue(age===null||Number.isInteger(age),'Age must be a whole number.');
    output.students.push({id:need(r.student_id,'student_id'),display_name:need(r.student_name||r.name,'student_name or name'),grade:canonicalGrade(need(r.grade,'grade')),age,attention_span_minutes:focus});
  });
  const studentFor=r=>{
    const identifier=str(r.student_id||r.student);
    const matches=output.students.filter(s=>s.id===identifier||s.display_name===identifier);
    requireValue(matches.length===1,`Cannot resolve student "${identifier}" uniquely. Use student_id.`);return matches[0];
  };
  run('Assessment',r=>output.assessments.push({code:need(r.assessment_code,'assessment_code'),name:need(r.assessment_name,'assessment_name'),term:str(r.term),status:active(r.status)?'active':'inactive'}));
  run('Curriculum',r=>{
    const source=need(r.curriculum_id,'curriculum_id'),assessment=need(r.assessment,'assessment');
    requireValue(output.assessments.some(a=>a.code===assessment),`Unknown assessment ${assessment}. Include Assessment.csv.`);
    output.curriculum.push({id:key('curriculum',source,assessment),source_id:source,lesson_code:str(r.lesson_code),grade:canonicalGrade(need(r.grade,'grade')),subject:need(r.subject,'subject'),category:str(r.category),lesson_name:need(r.lesson_name,'lesson_name'),term:str(r.term),assessment,chapter_no:str(r.chapter_no),difficulty:str(r.difficulty),learning_objective:str(r.learning_objective),keywords:str(r.keywords),estimated_hours:optionalNumber(r.estimated_hours,'estimated_hours',0.01,10000),status:active(r.status)?'active':'inactive'});
  });
  run('ExamCalendar',r=>{
    if(!active(r.status))return;
    const assessment=need(r.assessment_code,'assessment_code'),start=need(r.start_date,'start_date'),end=str(r.end_date)||start;
    requireValue(validDate(start)&&validDate(end)&&end>=start,'Exam dates must be real ISO dates (YYYY-MM-DD).');
    requireValue(output.assessments.some(a=>a.code===assessment),`Unknown assessment ${assessment}.`);
    let targets;
    if(r.student_id||r.student)targets=[studentFor(r)];
    else if(r.grade)targets=output.students.filter(s=>s.grade===canonicalGrade(r.grade));
    else {requireValue(expandSharedExams,'This exam has no student_id or grade. Review it, then explicitly use --expand-shared-exams if the window applies to both children.');targets=output.students;}
    requireValue(targets.length,'No students match this exam.');
    for(const s of targets) output.exams.push({id:key('exam',s.id,assessment,str(r.subject),start,end),student_id:s.id,assessment,subject:str(r.subject),start_date:start,end_date:end});
  });
  const dayNames=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  run('WeeklyAvailability',r=>{
    const s=studentFor(r), day=dayNames.indexOf(str(r.day).toLowerCase());
    requireValue(day>=0,'Use a full weekday name, such as Monday.');
    const slot=need(r.time_slot,'time_slot').split(/\s*[-–]\s*/);requireValue(slot.length===2,'Use HH:MM-HH:MM for time_slot.');
    const canStudy=str(r.can_study).toLowerCase();requireValue(['yes','no'].includes(canStudy),'can_study must be yes or no.');
    const start=minutes(slot[0]),end=minutes(slot[1]);
    output.availability.push({id:key('availability',s.id,day,start,end),student_id:s.id,day,start_minute:start,end_minute:end,fixed_activity:str(r.fixed_activity),can_study:canStudy==='yes'});
  });
  for(const s of output.students){try{validateSlots(output.availability.filter(a=>a.student_id===s.id));}catch(e){failures.push(`WeeklyAvailability for ${s.id}: ${e.message}`);}}
  run('LearningMaterials',r=>{
    const s=studentFor(r),driveId=need(r.drive_file_id,'drive_file_id');requireValue(/^[A-Za-z0-9_-]+$/.test(driveId),'Invalid Drive file ID.');
    output.materials.push({id:key('material',s.id,driveId),student_id:s.id,drive_file_id:driveId,title:need(r.file_name||r.title,'file_name or title'),subject:need(r.subject,'subject'),assessment:str(r.assessment),lesson_name:str(r.lesson_name||r.topic),summary:'',extracted_text:'',material_type:str(r.material_type)});
  });
  run('MaterialKnowledge',r=>{
    const s=studentFor(r),driveId=need(r.drive_file_id,'drive_file_id');
    const found=output.materials.find(m=>m.student_id===s.id&&m.drive_file_id===driveId);
    requireValue(found,'No LearningMaterials row with the same student_id and drive_file_id. Do not match on filename.');
    const concepts=str(r.concepts),summary=str(r.summary);
    found.summary=[summary,concepts?'Concepts: '+concepts:''].filter(Boolean).join('\n');
    found.extracted_text=str(r.extracted_text||r.text);
  });
  const mapped=new Set(['Students','Assessment','Curriculum','ExamCalendar','WeeklyAvailability','LearningMaterials','MaterialKnowledge']);
  for(const tab of Object.keys(sheets).filter(t=>!mapped.has(t))){
    run(tab,(r,i)=>{const s=studentFor(r);output.legacy_records.push({id:key(tab,s.id,i,r),student_id:s.id,source_tab:tab,data:r});});
    warnings.push(`${tab} is retained as historical source rows, not reinterpreted as new practice scores or live sessions.`);
  }
  for(const [table,records] of Object.entries(output)){
    const seen=new Map();
    for(const record of records){const id=record.id||record.code;if(seen.has(id)&&JSON.stringify(seen.get(id))!==JSON.stringify(record))failures.push(`${table}: conflicting rows for identity ${id}.`);else seen.set(id,record);}
    output[table]=[...seen.values()];
  }
  if(!output.students.length)failures.push('No active students found. Include Students.csv with real student records.');
  if(!output.curriculum.length)warnings.push('No curriculum is mapped yet. Timetables will stay unavailable until assessment portions are imported.');
  return {tables:output,warnings,failures,counts:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,v.length]))};
}
