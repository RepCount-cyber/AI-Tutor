import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(dir){let files=[];for(const item of await readdir(dir,{withFileTypes:true})){if(item.name.startsWith('.')||['node_modules','dist','imports'].includes(item.name))continue;const path=join(dir,item.name);files.push(...(item.isDirectory()?await walk(path):[path]));}return files;}
let count=0;
for(const path of await walk(root)){
  if(/\.(mjs|js)$/.test(path)){const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exit(1);}count++;}
  if(path.endsWith('.json'))JSON.parse(await readFile(path,'utf8'));
}
console.log(`${count} JavaScript modules passed syntax checking. JSON files are valid.`);
