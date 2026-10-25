import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

let server;
const port=3197,url=`http://127.0.0.1:${port}`;
before(async()=>{
  server=spawn(process.execPath,['scripts/dev.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),APP_ORIGIN:url,SUPABASE_URL:'',SUPABASE_ANON_KEY:''},stdio:['ignore','pipe','pipe']});
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw new Error('Server exited '+code);})]);
});
after(()=>server?.kill());
test('serves real login, sample preview and all frontend assets',async()=>{for(const path of ['/','/demo.html','/styles.css','/app.js','/sample.js','/mark.svg']){const r=await fetch(url+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');}});
test('real dashboard cannot become a demo login when storage is not connected',async()=>{const r=await fetch(url+'/api/dashboard');assert.equal(r.status,401);const body=await r.json();assert.ok(!JSON.stringify(body).includes('Sample learner'));});
test('status reports setup needed without exposing configuration values',async()=>{const r=await fetch(url+'/api/health');assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok',configured:false,version:'2.0.0'});});
test('local server rejects missing and private workspace paths',async()=>{for(const path of ['/package.json','/.env.local','/db/001_family_tutor.sql','/does-not-exist']){const r=await fetch(url+path);assert.equal(r.status,404);}});
test('cross-origin login is blocked at the running HTTP endpoint',async()=>{const r=await fetch(url+'/api/login',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({email:'a@example.test',password:'x'})});assert.equal(r.status,403);});
