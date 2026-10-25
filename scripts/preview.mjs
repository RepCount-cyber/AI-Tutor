import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('../',import.meta.url),read=name=>readFile(new URL('public/'+name,base),'utf8');
const css=(await read('styles.css')).replace("@import url('/type.css');",'');
const clean=source=>source.replace(/^export \{[^\n]+\};$/mg,'').replace(/export (async )?function /g,'$1function ').replace(/export const /g,'const ');
const catalog=clean(await read('pt2-catalog.js'));
const sample=clean(await read('sample.js')).replace("import {portionCatalog} from './pt2-catalog.js';",'');
const pdf=clean(await read('pdf-extract.js'));
const learning=clean(await read('learning-ui.js')).replace("import {extractSchoolFile,fileToBase64,suggestMaterial} from './pdf-extract.js';",'const {extractSchoolFile,fileToBase64,suggestMaterial}=PDFModule;');
const jarvis=clean(await read('jarvis.js'));
const code=clean(await read('app.js'))
 .replace("import { sampleData } from './sample.js';",'const {sampleData}=SampleModule;')
 .replace("import {configureJarvis,jarvisHTML,stopJarvisVoice} from './jarvis.js';",'const {configureJarvis,jarvisHTML,stopJarvisVoice}=JarvisModule;')
 .replace("import {configureLearningUI,portionsView,studyView,practiceView as learningPracticeView,uploadPanel,dailyPanel,timeSummary,heartbeat} from './learning-ui.js';",'const {configureLearningUI,portionsView,studyView,practiceView:learningPracticeView,uploadPanel,dailyPanel,timeSummary,heartbeat}=LearningModule;')
 .replaceAll('/demo.html?view=','?view=')
 .replace('<a href="/">Go to real sign in</a>','<span> · Standalone preview · Fictional progress</span>')
 .replace("if(preview){location.href='/';return;}","if(preview){location.reload();return;}");
const script=`const SampleModule=(()=>{${catalog}\n${sample}\nreturn {sampleData};})();\nconst PDFModule=(()=>{${pdf}\nreturn {extractSchoolFile,fileToBase64,suggestMaterial};})();\nconst LearningModule=(()=>{${learning}\nreturn {configureLearningUI,portionsView,studyView,practiceView,uploadPanel,dailyPanel,timeSummary,heartbeat};})();\nconst JarvisModule=(()=>{${jarvis}\nreturn {configureJarvis,jarvisHTML,stopJarvisVoice:stopVoice};})();\n${code}`;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Family Tutor · Jarvis and PT2 preview</title><style>${css}</style></head><body data-preview="true"><a class="skip" href="#main">Skip to content</a><div id="app"><main id="main" class="loading-screen">Opening the fictional sample preview…</main></div><div id="notification" class="toast" role="status" aria-live="polite" hidden></div><script type="module">${script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
await writeFile(new URL('PREVIEW.html',base),html);await writeFile(new URL('preview-check.mjs',base),script);
console.log('Self-contained PREVIEW.html generated. No fictional profile or progress is inserted in the live database.');
