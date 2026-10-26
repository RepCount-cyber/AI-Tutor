import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData} from '../public/sample.js';

const app={innerHTML:''};
global.document={body:{dataset:{preview:'true'}},querySelector(selector){if(selector==='#app')return app;return null;},addEventListener(){}};
global.location={search:''};
const {state,views,renderApp,loginView,esc,syncSelection}=await import('../public/app.js');
test('all parent dashboard views produce coherent HTML without undefined values',()=>{for(const page of Object.keys(views)){state.page=page;renderApp();assert.ok(app.innerHTML.includes('id="main"'));assert.ok(!app.innerHTML.includes('undefined'));assert.ok(!app.innerHTML.includes('NaN'));assert.match(app.innerHTML,/Sample preview/);}});
test('child account has no parent controls in navigation',()=>{state.data=sampleData('child');state.page='overview';syncSelection();renderApp();assert.ok(!app.innerHTML.includes('data-page="settings"'));assert.ok(!app.innerHTML.includes('data-student='));});
test('names, question text and AI replies are escaped before rendering',()=>{state.data=sampleData('parent');state.data.students[0].display_name='<img src=x onerror=alert(1)>';syncSelection();state.page='overview';renderApp();assert.ok(!app.innerHTML.includes('<img src=x'));assert.ok(app.innerHTML.includes('&lt;img'));state.messages=[{role:'assistant',content:'<script>alert(1)</script>'}];state.page='tutor';renderApp();assert.ok(!app.innerHTML.includes('<script>alert'));assert.ok(app.innerHTML.includes('&lt;script&gt;'));});
test('real login uses Google and does not request passwords or PINs',()=>{loginView();assert.match(app.innerHTML,/data-action="google-signin"/);assert.ok(!app.innerHTML.includes('type="password"'));assert.match(app.innerHTML,/no PIN/);});
test('blank connected account renders without fictional live student records',()=>{state.data=sampleData('parent');state.data.students=[];state.page='overview';renderApp();assert.match(app.innerHTML,/student records have not been linked/);assert.ok(!app.innerHTML.includes('Sample learner A'));});
test('text escaping covers HTML and attribute delimiters',()=>{assert.equal(esc('<a x="\'">&'), '&lt;a x=&quot;&#39;&quot;&gt;&amp;');});
