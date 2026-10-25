import { randomBytes, createHash } from 'node:crypto';
import { rows, eq } from './db.mjs';
import { parseCookies } from './auth.mjs';
import { requireValue, AppError } from './errors.mjs';
import { authConfig } from './neon-session.mjs';

export function appendCookie(res, value) {
  const existing=res.getHeader?.('Set-Cookie')||res.headers?.['Set-Cookie']||[];
  res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),value]);
}
export function cookie(name,value,maxAge=604800,oauth=false) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; HttpOnly; SameSite=${oauth?'Lax':'Strict'}; Path=/api${process.env.APP_ORIGIN?.startsWith('https:')||process.env.VERCEL_URL?'; Secure':''}`;
}
export function verifyFamilyUser(user,env=process.env) {
  requireValue(env.FAMILY_GOOGLE_EMAIL,'Configure the family Google account before signing in.',503);
  const google=user.app_metadata?.provider==='google' || user.app_metadata?.provider===undefined;
  const verified = user.email_verified === true || user.email_verified === undefined;
  requireValue(google && verified && user.email?.toLowerCase()===env.FAMILY_GOOGLE_EMAIL.trim().toLowerCase(),'Please use the configured family Google account.',403);
}
export function beginGoogle(res) {
  const cfg = authConfig();
  const verifier = randomBytes(32).toString('base64url');
  const state = JSON.stringify({ verifier, expires: Date.now() + 600000 });
  const target = new URL(cfg.base);
  target.searchParams.set('provider', 'google');
  target.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  target.searchParams.set('code_challenge_method', 's256');
  target.searchParams.set('scopes', 'openid email profile');
  target.searchParams.set('state', state);
  appendCookie(res, `oauth_state=${encodeURIComponent(state)}; Max-Age=600; HttpOnly; SameSite=Lax; Path=/api${process.env.APP_ORIGIN?.startsWith('https:')||process.env.VERCEL_URL?'; Secure':''}`);
  res.statusCode = 302;
  res.setHeader('Location', target.href);
  res.end();
}
export async function familyChoices(auth) {
  const students=await rows('students','select=*&order=id',{token:auth.token});
  return {profile:auth.familyProfile||auth.profile,students,choices:[{id:'parent',name:'Parent',role:'parent'},...students.map(s=>({id:s.id,name:s.display_name,grade:s.grade,role:'child'}))]};
}
export async function applyDeviceProfile(auth,req) {
  auth.familyProfile=auth.profile;
  let selected;try{selected=JSON.parse(parseCookies(req.headers.cookie).ft_profile||'{}');}catch{selected={};}
  if (selected.user && selected.user !== auth.user.id) { auth.selectedProfile=null; auth.deviceProfileMismatch=true; return auth; }
  if (!selected.user || !selected.pick) { auth.selectedProfile=null; return auth; }
  if(selected.pick==='parent'){auth.selectedProfile='parent';auth.profile={...auth.profile,role:'parent',display_name:'Parent'};return auth;}
  const students=await rows('students',`id=eq.${eq(selected.pick)}&select=*`,{token:auth.token});
  if(!students[0])throw new AppError(403,'That profile is not part of your family.');
  auth.selectedProfile=students[0].id;
  auth.profile={...auth.profile,role:'child',display_name:students[0].display_name,student_id:students[0].id};
  return auth;
}
export async function chooseDeviceProfile(auth,res,pick) {
  const choices=await familyChoices(auth);
  requireValue(choices.choices.some(c=>c.id===pick),'Choose one of your family profiles.',403);
  appendCookie(res,cookie('ft_profile',JSON.stringify({user:auth.user.id,pick})));
  appendCookie(res,cookie('ft_timer','',0));return {success:true};
}
