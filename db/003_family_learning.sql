-- Upgrade AFTER 001. One allowlisted Google identity owns the family.
-- Device profile selection is an application context, not a private account/PIN boundary.
begin;
alter table public.students add column daily_targets jsonb not null default '{"5":180,"6":180}';
alter table public.materials alter column drive_file_id drop not null;
alter table public.materials add column content_hash text;
alter table public.materials add column object_path text;
alter table public.materials add column mime_type text;
alter table public.materials add column byte_size integer;
alter table public.materials add column lesson_id text references public.curriculum(id);
alter table public.materials add column processing_status text not null default 'ready' check(processing_status in ('ready','needs_text','needs_review'));
alter table public.materials add column extraction_note text not null default '';
alter table public.materials add column created_at timestamptz not null default now();
create unique index material_content_identity on public.materials(student_id,content_hash) where content_hash is not null;

create table public.lesson_checkins (
  student_id text references public.students(id), lesson_id text references public.curriculum(id),
  study_date date not null, read_material boolean not null default false, completed_practice boolean not null default false,
  checked_mistakes boolean not null default false, can_explain boolean not null default false, needs_help boolean not null default false,
  notes text not null default '', confirmed_by text not null check(confirmed_by in ('student','parent')),
  updated_at timestamptz not null default now(), primary key(student_id,lesson_id,study_date)
);
create table public.portal_checks (
  student_id text references public.students(id), check_date date not null,
  has_new_material boolean not null, updated_at timestamptz not null default now(), primary key(student_id,check_date)
);
create table public.learning_sessions (
  id uuid primary key, student_id text not null references public.students(id), user_id uuid not null references public.profiles(id),
  lesson_id text not null references public.curriculum(id), device_hash text not null,
  started_at timestamptz not null default now(), last_seen timestamptz not null default now(),
  last_active boolean not null default true, active_seconds integer not null default 0, ended_at timestamptz
);
create unique index one_active_student_session on public.learning_sessions(student_id) where ended_at is null;
create table public.daily_study (
  student_id text references public.students(id), study_date date not null,
  active_seconds integer not null default 0, primary key(student_id,study_date)
);
create table public.offline_study (
  id uuid primary key default gen_random_uuid(), student_id text references public.students(id),
  lesson_id text not null references public.curriculum(id), study_date date not null,
  minutes integer not null check(minutes between 1 and 480), notes text not null default '',
  reported_by text not null check(reported_by in ('student','parent')), created_at timestamptz not null default now()
);
do $$ declare tab text; begin
  foreach tab in array array['lesson_checkins','portal_checks','learning_sessions','daily_study','offline_study'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy family_read on public.%I for select to authenticated using (private.can_access(student_id))',tab);
    execute format('revoke all on public.%I from anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
-- Do not expose per-device timer secret hashes to a browser or ordinary REST reader.
revoke select on public.learning_sessions from authenticated;
grant select(id,student_id,user_id,lesson_id,started_at,last_seen,last_active,active_seconds,ended_at) on public.learning_sessions to authenticated;

create function public.start_learning(sid text, lesson text, session_id uuid, secret_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not private.can_access(sid) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.curriculum c join public.students s on c.grade=s.grade where s.id=sid and c.id=lesson and c.status='active') then raise exception 'Invalid lesson'; end if;
  perform pg_advisory_xact_lock(hashtextextended('timer:'||sid,0));
  update public.learning_sessions set ended_at=last_seen,last_active=false where student_id=sid and ended_at is null and last_seen < now()-interval '2 minutes';
  if exists(select 1 from public.learning_sessions where student_id=sid and ended_at is null) then raise sqlstate '40001'; end if;
  insert into public.learning_sessions(id,student_id,user_id,lesson_id,device_hash) values(session_id,sid,auth.uid(),lesson,secret_hash);
  return session_id;
end $$;
create function public.learning_heartbeat(session_id uuid, secret_hash text, is_active boolean, finish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.learning_sessions; elapsed int:=0; first_part int; boundary timestamptz; begins timestamptz; today date:=(now() at time zone 'Asia/Dubai')::date; begin
  select * into s from public.learning_sessions where id=session_id for update;
  if s.id is null or s.user_id<>auth.uid() or not private.can_access(s.student_id) or s.device_hash<>secret_hash then raise insufficient_privilege; end if;
  if s.ended_at is not null then return jsonb_build_object('active_seconds',s.active_seconds,'ended',true); end if;
  if s.last_active and is_active then elapsed:=greatest(0,least(30,floor(extract(epoch from now()-s.last_seen))::int)); end if;
  if elapsed>0 then
    begins:=now()-make_interval(secs=>elapsed); boundary:=today::timestamp at time zone 'Asia/Dubai';
    if begins<boundary then
      first_part:=greatest(0,floor(extract(epoch from boundary-begins))::int);
      insert into public.daily_study values(s.student_id,today-1,first_part) on conflict(student_id,study_date) do update set active_seconds=public.daily_study.active_seconds+excluded.active_seconds;
      elapsed:=elapsed-first_part;
    else first_part:=0; end if;
    insert into public.daily_study values(s.student_id,today,elapsed) on conflict(student_id,study_date) do update set active_seconds=public.daily_study.active_seconds+excluded.active_seconds;
    elapsed:=elapsed+first_part;
  end if;
  update public.learning_sessions set active_seconds=active_seconds+elapsed,last_seen=now(),last_active=is_active and not finish,ended_at=case when finish then now() else null end where id=session_id;
  return jsonb_build_object('active_seconds',s.active_seconds+elapsed,'ended',finish);
end $$;

alter table public.practice_questions add column kind text not null default 'mcq' check(kind in ('mcq','fill_blank','short_answer','matching'));
alter table public.practice_questions add column details jsonb not null default '{}';
alter table public.practice_questions drop constraint practice_questions_choices_check;
alter table public.practice_questions add constraint practice_choices_shape check(jsonb_typeof(choices)='array' and ((kind='mcq' and jsonb_array_length(choices) between 2 and 6) or (kind<>'mcq' and jsonb_array_length(choices)<=12)));
alter table private.answer_keys alter column correct_index drop not null;
alter table private.answer_keys add column expected_answer jsonb;
alter table private.answer_keys add column rubric text not null default '';
alter table public.practice_attempts alter column correct drop not null;
alter table public.practice_attempts alter column chosen_index drop not null;
alter table public.practice_attempts add column response jsonb;
alter table public.practice_attempts add column review_status text not null default 'graded' check(review_status in ('graded','review_pending','parent_reviewed'));
alter table public.practice_attempts add column review_feedback text not null default '';
alter table public.practice_attempts add column reviewed_at timestamptz;

create function public.submit_response(qid uuid, answer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.practice_questions; k private.answer_keys; a public.practice_attempts; result boolean; picked int; helped boolean; status text:='graded'; begin
  select * into q from public.practice_questions where id=qid for update;
  if q.id is null or not private.can_access(q.student_id) then raise insufficient_privilege; end if;
  select * into k from private.answer_keys where question_id=qid;
  if k.question_id is null then raise exception 'No answer key'; end if;
  if q.kind='mcq' then
    picked:=(answer->>'choice')::int;
    if picked is null or picked<0 or picked>=jsonb_array_length(q.choices) then raise exception 'Invalid choice'; end if;
    result:=picked=k.correct_index;
  elsif q.kind='fill_blank' then
    if length(coalesce(answer->>'text','')) not between 1 and 2000 then raise exception 'Invalid response'; end if;
    select exists(select 1 from jsonb_array_elements_text(k.expected_answer) t(v) where lower(regexp_replace(trim(v),'\s+',' ','g'))=lower(regexp_replace(trim(answer->>'text'),'\s+',' ','g'))) into result;
  elsif q.kind='matching' then
    if jsonb_typeof(answer->'matches')<>'array' or jsonb_array_length(answer->'matches')<>jsonb_array_length(k.expected_answer) then raise exception 'Invalid matches'; end if;
    result:=(answer->'matches')=k.expected_answer;
  else
    if length(coalesce(answer->>'text','')) not between 1 and 4000 then raise exception 'Invalid response'; end if;
    result:=null;status:='review_pending';
  end if;
  select exists(select 1 from public.conversations c join public.messages m on m.conversation_id=c.id where c.student_id=q.student_id and c.lesson_id=q.lesson_id and m.role='assistant' and m.created_at>now()-interval '30 minutes') into helped;
  insert into public.practice_attempts(question_id,student_id,chosen_index,correct,assisted,response,review_status)
    values(qid,q.student_id,picked,result,helped,answer,status) on conflict(question_id,student_id) do nothing;
  select * into a from public.practice_attempts where question_id=qid and student_id=q.student_id;
  return jsonb_build_object('correct',a.correct,'chosen_index',a.chosen_index,'correct_index',k.correct_index,'expected_answer',k.expected_answer,'explanation',k.explanation,'assisted',a.assisted,'review_status',a.review_status,'review_feedback',a.review_feedback);
end $$;
create or replace function public.submit_answer(qid uuid, chosen integer) returns jsonb language sql security definer set search_path='' as $$ select public.submit_response(qid,jsonb_build_object('choice',chosen)); $$;
create or replace function public.review_answer(qid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.practice_questions;k private.answer_keys;a public.practice_attempts;begin
  select * into q from public.practice_questions where id=qid;
  if q.id is null or not private.can_access(q.student_id) then raise insufficient_privilege;end if;
  select * into k from private.answer_keys where question_id=qid;
  select * into a from public.practice_attempts where question_id=qid and student_id=q.student_id;
  return jsonb_build_object('correct',a.correct,'correct_index',k.correct_index,'expected_answer',k.expected_answer,'explanation',k.explanation,'assisted',a.assisted,'review_status',a.review_status,'review_feedback',a.review_feedback,'rubric',k.rubric);
end $$;
create function public.grade_response(attempt_id uuid, is_correct boolean, feedback text) returns void language plpgsql security definer set search_path='' as $$
declare a public.practice_attempts;begin
  select * into a from public.practice_attempts where id=attempt_id for update;
  if not private.is_parent() or a.id is null or not private.can_access(a.student_id) then raise insufficient_privilege;end if;
  if not exists(select 1 from public.practice_questions where id=a.question_id and kind='short_answer') then raise exception 'Only short answers need manual grading';end if;
  if is_correct is null then raise exception 'Choose a result';end if;
  update public.practice_attempts set correct=is_correct,review_status='parent_reviewed',review_feedback=left(feedback,4000),reviewed_at=now() where id=attempt_id;
end $$;
create or replace function public.save_ai_questions(sid text, lesson text, questions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb;qid uuid;kind text;begin
  for entry in select * from jsonb_array_elements(questions) loop
    kind:=coalesce(entry->>'kind','mcq');
    insert into public.practice_questions(student_id,lesson_id,prompt,choices,source,kind,details)
      values(sid,lesson,entry->>'prompt',coalesce(entry->'choices','[]'::jsonb),'ai',kind,coalesce(entry->'details','{}'::jsonb)) returning id into qid;
    insert into private.answer_keys(question_id,correct_index,explanation,expected_answer,rubric)
      values(qid,(entry->>'correct_index')::int,entry->>'explanation',entry->'expected_answer',coalesce(entry->>'rubric',''));
  end loop;
end $$;
revoke all on function public.start_learning(text,text,uuid,text),public.learning_heartbeat(uuid,text,boolean,boolean),public.submit_response(uuid,jsonb),public.grade_response(uuid,boolean,text) from public,anon;
grant execute on function public.start_learning(text,text,uuid,text),public.learning_heartbeat(uuid,text,boolean,boolean),public.submit_response(uuid,jsonb),public.grade_response(uuid,boolean,text) to authenticated;
revoke all on function public.save_ai_questions(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_ai_questions(text,text,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('family-materials','family-materials',false,2097152,array['application/pdf','image/png','image/jpeg','image/webp','text/plain']) on conflict(id) do nothing;
create policy family_material_object_read on storage.objects for select to authenticated using(bucket_id='family-materials' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.profiles where id=auth.uid()));
create policy family_material_object_insert on storage.objects for insert to authenticated with check(bucket_id='family-materials' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.profiles where id=auth.uid()));
revoke all on all tables in schema private from public,anon,authenticated;
create index on public.lesson_checkins(student_id,study_date);
create index on public.offline_study(student_id,study_date);
create index on public.learning_sessions(student_id,last_seen);
commit;
