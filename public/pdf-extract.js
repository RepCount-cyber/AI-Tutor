export async function extractSchoolFile(file,onProgress=()=>{}) {
  if(file.type==='text/plain'||file.name.toLowerCase().endsWith('.txt'))return {text:(await file.text()).slice(0,65000),note:'UTF-8 text file; review the text before saving.'};
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))return {text:'',note:'Image uploaded. Paste the readable lesson/worksheet text below; automatic image OCR is not connected.'};
  const pdfjs=await import('./vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
  const job=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true});
  let pdf;
  try {
    pdf=await job.promise;
    const pages=[],unreadable=[];const count=Math.min(pdf.numPages,60);
    for(let i=1;i<=count;i++){
      onProgress(`Reading page ${i} of ${pdf.numPages}…`);
      const page=await pdf.getPage(i),content=await page.getTextContent();
      const text=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
      if(text.length<20)unreadable.push(i);else pages.push(`[Page ${i}]\n${text}`);
    }
    let text=pages.join('\n\n');const truncated=text.length>65000||pdf.numPages>60;text=text.slice(0,65000);
    return {text,note:`Text extracted from ${pages.length}/${pdf.numPages} pages.${unreadable.length?' Pages needing text/OCR: '+unreadable.join(', ')+'.':''}${truncated?' Extraction was shortened; split the file or provide the full relevant text.':''} Check reading order, mathematical notation and language text before confirming.`,partial:unreadable.length>0||truncated};
  } catch {return {text:'',note:'The PDF text could not be read. It may be scanned, protected or damaged. Paste the relevant text, or upload a readable version.',partial:true};}
  finally {await pdf?.destroy();}
}
export async function fileToBase64(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
export function suggestMaterial(fileName,text,lessons) {
  const haystack=(fileName+' '+text.slice(0,12000)).toLowerCase();
  const matches=lessons.filter(l=>haystack.includes(l.lesson_name.toLowerCase()));
  const subjects=[...new Set(lessons.map(l=>l.subject))].filter(s=>new RegExp('\\b'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(haystack));
  return {lesson_id:matches.length===1?matches[0].id:'',subject:matches.length===1?matches[0].subject:subjects.length===1?subjects[0]:''};
}
