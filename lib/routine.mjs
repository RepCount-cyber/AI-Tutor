// Proposed routine from the supplied examples; parent can edit all slots.
// School learning/homework slots are distinct from Quran, madrasa, meals and play.
export function routineForGrade(grade){
  const slots=[];
  const add=(day,start,end,can_study,label)=>slots.push({day,start_minute:start,end_minute:end,can_study,fixed_activity:label});
  for(let day=0;day<5;day++){
    add(day,grade==='Grade 1'?450:495,grade==='Grade 1'?885:950,false,'School — verify current travel and school hours');
    add(day,960,1020,true,'School study / homework');
    add(day,1020,grade==='Grade 1'?1140:1125,false,'Play, reading and rest');
    add(day,grade==='Grade 1'?1140:1125,grade==='Grade 1'?1160:1155,false,grade==='Grade 1'?'Surah revision':'Quran reading');
    add(day,grade==='Grade 1'?1160:1155,1200,false,'Dinner and family time');
    add(day,1200,1260,true,'Homework / light revision');
  }
  add(5,510,780,false,'Madrasa — confirmed Saturday 08:30–13:00');
  add(5,780,840,false,'Travel, lunch and rest');
  for(const [start,end] of [[840,910],[930,1000],[1200,1270]])add(5,start,end,true,'Weekend study block — 60 study minutes plus breaks');
  for(const [start,end] of [[540,610],[660,730],[960,1030]])add(6,start,end,true,'Weekend study block — 60 study minutes plus breaks');
  return slots;
}
