import { readFile,readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCSV } from '../lib/csv.mjs';
import { transformSheets } from '../lib/migration.mjs';
import { request } from '../lib/db.mjs';

const args=process.argv.slice(2),flag=args.indexOf('--dir');
if(flag<0||!args[flag+1]){console.log('Usage: node --env-file-if-exists=.env.local scripts/import.mjs --dir ./imports [--expand-shared-exams] [--apply]\nDefault is dry-run. No data is written without --apply.');process.exit(0);}
try{
  const dir=resolve(args[flag+1]),sheets={};
  const aliases={Weak_Areas:'WeakAreas',Parent_Reports:'ParentReports',Assessments:'Assessment'};
  for(const file of (await readdir(dir)).filter(f=>f.toLowerCase().endsWith('.csv'))){const raw=file.replace(/\.csv$/i,''),name=aliases[raw]||raw;if(sheets[name])throw new Error(`Duplicate source tab: ${name}`);sheets[name]=parseCSV(await readFile(resolve(dir,file),'utf8'));}
  const result=transformSheets(sheets,{expandSharedExams:args.includes('--expand-shared-exams')});
  console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',counts:result.counts,warnings:result.warnings,failures:result.failures},null,2));
  if(result.failures.length)process.exit(1);
  if(!args.includes('--apply')){console.log('Validation passed. Review the mapping report before using --apply.');process.exit(0);}
  for(const [table,records] of Object.entries(result.tables)){
    for(let offset=0;offset<records.length;offset+=200)await request(`/rest/v1/${table}?on_conflict=${table==='assessments'?'code':'id'}`,{admin:true,method:'POST',body:records.slice(offset,offset+200),prefer:'resolution=merge-duplicates,return=minimal'});
    console.log(`Saved ${records.length} ${table} rows.`);
  }
  console.log('Import complete. No source files or old workflows were changed. If an earlier batch failed, rerun the same validated import; stable IDs make it repeatable.');
}catch(e){console.error('Import stopped:',e.message);process.exitCode=1;}
