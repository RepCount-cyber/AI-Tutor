import {createHash} from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import {rows,request,eq,config} from './db.mjs';
import {allowedStudent} from './auth.mjs';
import {resolveLesson} from './learning.mjs';
import {AppError,requireValue,text} from './errors.mjs';

export const MAX_FILE_BYTES=2*1024*1024;
export function inspectUpload(b) {
  requireValue(typeof b.file_base64==='string'&&b.file_base64.length<=Math.ceil(MAX_FILE_BYTES/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.file_base64),'Upload a file up to 2 MB.');
  const bytes=Buffer.from(b.file_base64,'base64');requireValue(bytes.length>0&&bytes.length<=MAX_FILE_BYTES,'Upload a nonempty file up to 2 MB.');
  let mime,ext;
  if(bytes.subarray(0,5).toString()==='%PDF-'){mime='application/pdf';ext='pdf';}
  else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';ext='png';}
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){mime='image/jpeg';ext='jpg';}
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'){mime='image/webp';ext='webp';}
  else if(b.mime_type==='text/plain'&&!bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD')){mime='text/plain';ext='txt';}
  else throw new AppError(400,'Supported files: PDF, PNG, JPEG, WebP or UTF-8 text.');
  return {bytes,mime,ext,hash:createHash('sha256').update(bytes).digest('hex')};
}
export async function storage(path,{token,method='GET',bytes,mime}={}) {
  const cfg=config();
  const bucket = cfg.bucket || 'family-materials';
  const awsConfigured = Boolean(cfg.awsEndpoint && cfg.accessKeyId && cfg.secretAccessKey);
  if (awsConfigured) {
    const objectKey = path
      .replace(/^object\/(?:[^/]+)\//, '')
      .replace(/^authenticated\/(?:[^/]+)\//, '')
      .replace(/^public\/(?:[^/]+)\//, '');
    const client = new S3Client({
      region: cfg.region || 'us-east-2',
      endpoint: cfg.awsEndpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
    });
    if (method === 'POST') {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: bytes, ContentType: mime || 'application/octet-stream' }));
      return { ok: true };
    }
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    const body = await object.Body?.transformToByteArray?.() ?? Buffer.from(await object.Body?.arrayBuffer?.() ?? []);
    return {
      ok: true,
      async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
      status: 200,
    };
  }
  if (!cfg.url) throw new AppError(503, 'The private file bucket is not configured for this deployment.');
  let res;
  try{res=await fetch(cfg.url+'/storage/v1/'+path,{method,headers:{apikey:cfg.key,Authorization:'Bearer '+token,...(mime?{'Content-Type':mime}:{}),'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(20000),cache:'no-store'});}catch{throw new AppError(502,'The file store could not be reached. Please try again.');}
  if(!res.ok&&res.status!==409)throw new AppError(502,'The school file could not be saved or opened. Check that the private file bucket is installed.');return res;
}
export async function uploadMaterial(auth,b) {
  const student=await allowedStudent(auth,text(b.student_id,80));
  const {bytes,mime,ext,hash}=inspectUpload(b),title=text(b.title,240),subject=text(b.subject,100),assessment=text(b.assessment,80);
  const eligible=await rows('curriculum',`grade=eq.${eq(student.grade)}&subject=eq.${eq(subject)}&assessment=eq.${eq(assessment)}&limit=1`,{token:auth.token});requireValue(eligible.length,'Confirm a subject in this student’s assessment.');
  let lesson=null;if(b.lesson_id)lesson=(await resolveLesson(auth,student.id,b.lesson_id)).lesson;
  requireValue(!lesson||(lesson.subject===subject&&lesson.assessment===assessment),'The lesson does not match the selected subject and assessment.');
  const existing=await rows('materials',`student_id=eq.${eq(student.id)}&content_hash=eq.${hash}&select=id,title`,{token:auth.token});
  if(existing.length)return {success:true,duplicate:true,id:existing[0].id,message:'This exact file is already saved for this child.'};
  const extracted=mime==='text/plain'?bytes.toString('utf8').slice(0,65000):String(b.extracted_text||'').slice(0,65000);
  const reviewed = b.text_reviewed === true;
  const status = extracted.trim().length < 30 ? 'needs_text' : reviewed ? 'ready' : 'needs_review';
  const path=`${auth.user.id}/${createHash('sha256').update(student.id).digest('hex').slice(0,16)}/${hash}.${ext}`;
  await storage('object/family-materials/'+path,{token:auth.token,method:'POST',bytes,mime});
  const record={id:'upload-'+createHash('sha256').update(student.id+':'+hash).digest('hex'),student_id:student.id,drive_file_id:null,content_hash:hash,object_path:path,mime_type:mime,byte_size:bytes.length,title,subject,assessment,lesson_id:lesson?.id||null,lesson_name:lesson?.lesson_name||'',summary:'',extracted_text:extracted,material_type:String(b.material_type||'school_material').slice(0,80),processing_status:status,extraction_note:String(b.extraction_note||'').slice(0,1000)};
  await request('/rest/v1/materials?on_conflict=id',{admin:true,method:'POST',body:record,prefer:'resolution=ignore-duplicates,return=minimal'});
  return {success:true,id:record.id,processing_status:status,message:status==='ready'?'School material saved and ready for lesson-based practice.':'File saved. Readable, reviewed text is needed before question generation.'};
}
export async function updateMaterialText(auth,b) {
  const found=(await rows('materials',`id=eq.${eq(text(b.id,200))}&select=*`,{token:auth.token}))[0];requireValue(found,'Material not found.',404);await allowedStudent(auth,found.student_id);
  const content=text(b.extracted_text,65000);requireValue(content.length>=30&&b.text_reviewed===true,'Review at least 30 characters of material text before saving.');
  await request(`/rest/v1/materials?id=eq.${eq(found.id)}`,{admin:true,method:'PATCH',body:{extracted_text:content,processing_status:'ready',extraction_note:'Text reviewed by the family.'}});return {success:true};
}
export async function materialText(auth,id) {const m=(await rows('materials',`id=eq.${eq(text(id,200))}&select=*`,{token:auth.token}))[0];requireValue(m,'Material not found.',404);await allowedStudent(auth,m.student_id);return m;}
export async function downloadMaterial(auth,id,res) {
  const m=await materialText(auth,id);requireValue(m.object_path,'Open this material through its original Drive link.');
  requireValue(m.object_path.startsWith(auth.user.id+'/'),'File is outside the family store.',403);
  const source=await storage('object/authenticated/family-materials/'+m.object_path,{token:auth.token});const bytes=Buffer.from(await source.arrayBuffer());
  requireValue(bytes.length<=MAX_FILE_BYTES,'File exceeds the download limit.',413);
  res.statusCode=200;res.setHeader('Content-Type',m.mime_type);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(m.title)}`);res.end(bytes);
}
