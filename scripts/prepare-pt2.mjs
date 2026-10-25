import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {rows,request} from '../lib/db.mjs';
import {routineForGrade} from '../lib/routine.mjs';
import {validateSlots} from '../lib/planner.mjs';
const catalog=JSON.parse(await readFile(new URL('../data/pt2-2026.json',import.meta.url),'utf8'));
const apply=process.argv.includes('--apply');
console.log(JSON.stringify({mode:apply?'apply':'dry-run',assessment:'PT2',dates:'Not announced',portions:catalog.portions.length,scope_notes:catalog.scope_notes},null,2));
if(!apply){console.log('Review the catalog and routine in data/pt2-2026.json and lib/routine.mjs. Use --apply only after importing real Students.csv.');process.exit(0);}
try{
  const students=await rows('students','select=*',{admin:true});
  if(students.length!==2||!students.some(s=>s.grade==='Grade 1')||!students.some(s=>s.grade==='Grade 8'))throw new Error('Import exactly the two existing Grade 1 and Grade 8 student records first. Names/IDs are never invented.');
  await request('/rest/v1/assessments?on_conflict=code',{admin:true,method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{code:'PT2',name:'Periodic Test 2',term:'2',status:'active'}});
  const existingPortions=await rows('curriculum','assessment=eq.PT2&select=grade',{admin:true});
  const keptGrades=new Set(existingPortions.map(p=>p.grade));
  const portions=catalog.portions.filter(p=>!keptGrades.has(p.grade)).map((p,i)=>({id:'school-2026-pt2-'+createHash('sha256').update(p.grade+'|'+p.subject+'|'+p.category+'|'+p.lesson_name).digest('hex').slice(0,24),source_id:'school-2026-pt2-'+i,grade:p.grade,subject:p.subject,category:p.category,lesson_code:p.lesson_code,lesson_name:p.lesson_name,term:'2',assessment:'PT2',status:'active',learning_objective:'PT2 portion from school term-wise breakup; source PDF page '+p.source_page}));
  if(portions.length)await request('/rest/v1/curriculum?on_conflict=id',{admin:true,method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:portions});
  for(const s of students){
    const existing=await rows('availability','student_id=eq.'+encodeURIComponent(s.id)+'&limit=1',{admin:true});
    if(existing.length){console.log('Kept existing availability for student '+s.id+'.');continue;}
    const slots=validateSlots(routineForGrade(s.grade));
    await request('/rest/v1/availability',{admin:true,method:'POST',body:slots.map((slot,i)=>({...slot,id:'routine-'+s.id+'-'+i,student_id:s.id})),prefer:'return=minimal'});
    await request('/rest/v1/students?id=eq.'+encodeURIComponent(s.id),{admin:true,method:'PATCH',body:{attention_span_minutes:s.grade==='Grade 1'?20:25,daily_targets:{5:180,6:180}}});
  }
  console.log('PT2 portions and initial routine saved. No exam dates were invented. Existing study availability was preserved.');
}catch(e){console.error('PT2 setup stopped:',e.message);process.exitCode=1;}
