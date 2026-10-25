-- New database schema. Existing Sheets columns are mapped by scripts/import.mjs.
-- Run in a NEW Supabase project as the project database administrator.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  role text not null check (role in ('parent','child'))
);
create table public.students (
  id text primary key check (length(id) between 1 and 80),
  display_name text not null,
  grade text not null,
  age integer check (age between 3 and 22),
  attention_span_minutes integer not null default 25 check (attention_span_minutes between 5 and 50),
  subject_priorities jsonb not null default '{}' check (jsonb_typeof(subject_priorities) = 'object')
);
create table public.student_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  student_id text not null unique references public.students(id) on delete cascade
);
create table public.parent_students (
  parent_id uuid references public.profiles(id) on delete cascade,
  student_id text references public.students(id) on delete cascade,
  primary key (parent_id, student_id)
);

create function private.is_parent() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'parent');
$$;
create function private.can_access(sid text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.student_accounts where user_id = (select auth.uid()) and student_id = sid)
  or exists(select 1 from public.parent_students where parent_id = (select auth.uid()) and student_id = sid);
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_parent(), private.can_access(text) to authenticated;

create table public.assessments (
  code text primary key, name text not null, term text not null default '', status text not null default 'active'
);
create table public.curriculum (
  id text primary key,
  source_id text not null,
  lesson_code text not null default '', grade text not null, subject text not null,
  category text not null default '', lesson_name text not null,
  term text not null default '', assessment text not null references public.assessments(code),
  chapter_no text not null default '', difficulty text not null default '',
  learning_objective text not null default '', keywords text not null default '',
  estimated_hours numeric check (estimated_hours > 0), status text not null default 'active'
);
create table public.exams (
  id text primary key, student_id text not null references public.students(id),
  assessment text not null references public.assessments(code),
  subject text not null default '', start_date date not null, end_date date not null,
  check (end_date >= start_date)
);
create table public.availability (
  id text primary key, student_id text not null references public.students(id),
  day integer not null check (day between 0 and 6), -- Monday = 0
  start_minute integer not null check (start_minute >= 0),
  end_minute integer not null check (end_minute <= 1440 and end_minute > start_minute),
  fixed_activity text not null default '', can_study boolean not null default true
);
create table public.materials (
  id text primary key, student_id text not null references public.students(id),
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]+$'),
  title text not null, subject text not null, assessment text not null default '',
  lesson_name text not null default '', summary text not null default '',
  extracted_text text not null default '', material_type text not null default '',
  unique(student_id, drive_file_id)
);
create table public.study_plans (
  id uuid primary key default gen_random_uuid(), student_id text not null references public.students(id),
  assessment text not null references public.assessments(code), week_start date not null,
  revision integer not null default 1, warnings jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(student_id, week_start), unique(id, student_id),
  check (extract(isodow from week_start) = 1)
);
create table public.study_tasks (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null, student_id text not null,
  lesson_id text not null references public.curriculum(id), assessment text not null,
  subject text not null, topic text not null, scheduled_date date not null,
  start_minute integer not null check (start_minute between 0 and 1439),
  planned_minutes integer not null check (planned_minutes between 5 and 50),
  activity text not null, status text not null default 'planned' check (status in ('planned','done','skipped')),
  completed_at timestamptz, foreign key(plan_id,student_id) references public.study_plans(id,student_id) on delete cascade,
  check (start_minute + planned_minutes <= 1440)
);
create table public.practice_questions (
  id uuid primary key default gen_random_uuid(), student_id text not null references public.students(id),
  lesson_id text not null references public.curriculum(id), prompt text not null,
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6),
  source text not null check (source in ('parent','ai')), created_at timestamptz not null default now(),
  unique(id,student_id)
);
create table private.answer_keys (
  question_id uuid primary key references public.practice_questions(id) on delete cascade,
  correct_index integer not null check(correct_index between 0 and 5), explanation text not null
);
create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(), question_id uuid not null, student_id text not null,
  chosen_index integer not null, correct boolean not null, assisted boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique(question_id, student_id),
  foreign key(question_id,student_id) references public.practice_questions(id,student_id)
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), student_id text not null references public.students(id),
  lesson_id text not null references public.curriculum(id), author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), unique(id,student_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null, student_id text not null,
  role text not null check(role in ('user','assistant')), content text not null,
  created_at timestamptz not null default now(), sequence bigint generated always as identity,
  foreign key(conversation_id,student_id) references public.conversations(id,student_id)
);
create table public.legacy_records (
  id text primary key, student_id text not null references public.students(id),
  source_tab text not null, data jsonb not null, imported_at timestamptz not null default now()
);
create table private.ai_usage (
  user_id uuid not null references public.profiles(id), bucket text not null,
  count integer not null default 0, primary key(user_id, bucket)
);

-- Reads are checked at the database layer. No client can set their own role or grades.
alter table public.profiles enable row level security;
create policy self_profile on public.profiles for select to authenticated using (id = (select auth.uid()));
alter table public.students enable row level security;
create policy student_read on public.students for select to authenticated using (private.can_access(id));
alter table public.student_accounts enable row level security;
create policy account_read on public.student_accounts for select to authenticated using (user_id = (select auth.uid()));
alter table public.parent_students enable row level security;
create policy family_read on public.parent_students for select to authenticated using (parent_id = (select auth.uid()));
alter table public.assessments enable row level security;
create policy assessment_read on public.assessments for select to authenticated using (exists(select 1 from public.profiles where id = (select auth.uid())));
alter table public.curriculum enable row level security;
create policy curriculum_read on public.curriculum for select to authenticated using (
  exists(select 1 from public.students s where s.grade = curriculum.grade and private.can_access(s.id))
);
do $$ declare tab text; begin
  foreach tab in array array['exams','availability','materials','study_plans','study_tasks','practice_questions','practice_attempts','conversations','messages','legacy_records'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('create policy scoped_read on public.%I for select to authenticated using (private.can_access(student_id))', tab);
  end loop;
end $$;
-- Conversations are server-created after authorization. All mutations use checked RPCs.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles,public.students,public.student_accounts,public.parent_students,public.assessments,public.curriculum,
  public.exams,public.availability,public.materials,public.study_plans,public.study_tasks,public.practice_questions,
  public.practice_attempts,public.conversations,public.messages,public.legacy_records to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

create function public.complete_task(task_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare task public.study_tasks; begin
  select * into task from public.study_tasks where id = task_id for update;
  if task.id is null or not private.can_access(task.student_id) then raise insufficient_privilege; end if;
  if task.scheduled_date > (now() at time zone 'Asia/Dubai')::date then raise exception 'Future tasks cannot be marked done'; end if;
  update public.study_tasks set status = 'done', completed_at = coalesce(completed_at, now()) where id = task_id;
  return jsonb_build_object('success',true);
end $$;

create function public.submit_answer(qid uuid, chosen integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.practice_questions; a private.answer_keys; attempt public.practice_attempts; helped boolean; begin
  select * into q from public.practice_questions where id = qid for update;
  if q.id is null or not exists(select 1 from public.student_accounts where user_id = auth.uid() and student_id = q.student_id)
    then raise insufficient_privilege; end if;
  if chosen < 0 or chosen >= jsonb_array_length(q.choices) then raise exception 'Invalid answer'; end if;
  select * into a from private.answer_keys where question_id = qid;
  if a.question_id is null then raise exception 'Answer key is unavailable'; end if;
  select exists(select 1 from public.conversations c join public.messages m on m.conversation_id = c.id
    where c.author_id = auth.uid() and c.student_id = q.student_id and c.lesson_id = q.lesson_id
      and m.role = 'assistant' and m.created_at > now() - interval '30 minutes') into helped;
  insert into public.practice_attempts(question_id,student_id,chosen_index,correct,assisted)
    values(qid,q.student_id,chosen,chosen = a.correct_index,helped) on conflict(question_id,student_id) do nothing;
  select * into attempt from public.practice_attempts where question_id = qid and student_id = q.student_id;
  return jsonb_build_object('correct',attempt.correct,'chosen_index',attempt.chosen_index,'correct_index',a.correct_index,
    'explanation',a.explanation,'assisted',attempt.assisted);
end $$;

create function public.set_availability(sid text, slots jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_parent() or not private.can_access(sid) then raise insufficient_privilege; end if;
  if jsonb_typeof(slots) <> 'array' or jsonb_array_length(slots) > 100 then raise exception 'Invalid slots'; end if;
  if exists(select 1 from jsonb_to_recordset(slots) as s(day int,start_minute int,end_minute int)
    where day not between 0 and 6 or start_minute < 0 or end_minute > 1440 or end_minute <= start_minute or day is null or start_minute is null or end_minute is null) then raise exception 'Invalid slot'; end if;
  if exists(select 1 from jsonb_array_elements(slots) with ordinality a(v,i),jsonb_array_elements(slots) with ordinality b(v,i)
    where a.i < b.i and (a.v->>'day')::int = (b.v->>'day')::int and (a.v->>'start_minute')::int < (b.v->>'end_minute')::int
      and (b.v->>'start_minute')::int < (a.v->>'end_minute')::int) then raise exception 'Slots overlap'; end if;
  perform pg_advisory_xact_lock(hashtextextended('availability:' || sid,0));
  delete from public.availability where student_id = sid;
  insert into public.availability(id,student_id,day,start_minute,end_minute,fixed_activity,can_study)
  select gen_random_uuid()::text,sid,s.day,s.start_minute,s.end_minute,coalesce(s.fixed_activity,''),coalesce(s.can_study,true)
    from jsonb_to_recordset(slots) as s(day int,start_minute int,end_minute int,fixed_activity text,can_study boolean);
end $$;

create function public.review_answer(qid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.practice_questions; a private.answer_keys; attempt public.practice_attempts; begin
  select * into q from public.practice_questions where id = qid;
  if q.id is null or not private.can_access(q.student_id) then raise insufficient_privilege; end if;
  select * into attempt from public.practice_attempts where question_id = qid and student_id = q.student_id;
  if not private.is_parent() and attempt.id is null then raise insufficient_privilege; end if;
  select * into a from private.answer_keys where question_id = qid;
  return jsonb_build_object('correct_index',a.correct_index,'explanation',a.explanation,'correct',attempt.correct,'assisted',attempt.assisted);
end $$;

create function public.save_exam(sid text, exam_id text, assessment_code text, exam_subject text, starts date, ends date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_parent() or not private.can_access(sid) then raise insufficient_privilege; end if;
  if exists(select 1 from public.exams where id = exam_id and student_id <> sid) then raise insufficient_privilege; end if;
  insert into public.exams(id,student_id,assessment,subject,start_date,end_date)
    values(exam_id,sid,assessment_code,coalesce(exam_subject,''),starts,ends)
    on conflict(id) do update set assessment = excluded.assessment,subject = excluded.subject,start_date = excluded.start_date,end_date = excluded.end_date;
end $$;

create function public.set_preferences(sid text, focus_minutes integer, priorities jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_parent() or not private.can_access(sid) then raise insufficient_privilege; end if;
  if jsonb_typeof(priorities) <> 'object' or exists(select 1 from jsonb_each_text(priorities) where value not in ('1','2','3'))
    then raise exception 'Invalid priorities'; end if;
  update public.students set attention_span_minutes = focus_minutes, subject_priorities = priorities where id = sid;
end $$;

create function public.add_question(sid text, lesson text, question text, options jsonb, answer integer, explanation text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare qid uuid; begin
  if not private.is_parent() or not private.can_access(sid) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.curriculum c join public.students s on s.grade = c.grade where s.id = sid and c.id = lesson)
    then raise insufficient_privilege; end if;
  if length(question) not between 1 and 4000 or length(explanation) not between 1 and 8000
    or answer < 0 or answer >= jsonb_array_length(options) then raise exception 'Invalid question'; end if;
  insert into public.practice_questions(student_id,lesson_id,prompt,choices,source) values(sid,lesson,question,options,'parent') returning id into qid;
  insert into private.answer_keys values(qid,answer,explanation);
  return qid;
end $$;

create function public.save_weekly_plan(sid text, assessment_code text, starts date, expected_revision integer, sessions jsonb, notices jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid; current_revision int; entry jsonb; c public.curriculum; d date; st int; dur int; begin
  if not private.is_parent() or not private.can_access(sid) then raise insufficient_privilege; end if;
  if extract(isodow from starts) <> 1 or jsonb_typeof(sessions) <> 'array' or jsonb_array_length(sessions) > 100 then raise exception 'Invalid plan'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sid || ':' || starts::text,0));
  select id,revision into pid,current_revision from public.study_plans where student_id = sid and week_start = starts for update;
  if coalesce(current_revision,0) <> expected_revision then raise sqlstate '40001'; end if;
  if pid is null then
    insert into public.study_plans(student_id,assessment,week_start,warnings) values(sid,assessment_code,starts,notices) returning id into pid;
  else
    update public.study_plans set assessment = assessment_code,revision = revision + 1,warnings = notices,updated_at = now() where id = pid;
    delete from public.study_tasks where plan_id = pid and status = 'planned' and (
      scheduled_date > (now() at time zone 'Asia/Dubai')::date or
      (scheduled_date = (now() at time zone 'Asia/Dubai')::date and start_minute >=
        extract(hour from (now() at time zone 'Asia/Dubai'))::int * 60 + extract(minute from (now() at time zone 'Asia/Dubai'))::int));
  end if;
  for entry in select * from jsonb_array_elements(sessions) loop
    select * into c from public.curriculum where id = entry->>'lesson_id';
    d := (entry->>'scheduled_date')::date; st := (entry->>'start_minute')::int; dur := (entry->>'planned_minutes')::int;
    if c.id is null or c.assessment <> assessment_code or not exists(select 1 from public.students where id = sid and grade = c.grade)
      or d < starts or d > starts + 6 or d < (now() at time zone 'Asia/Dubai')::date then raise exception 'Invalid planned lesson'; end if;
    if not exists(select 1 from public.availability a where a.student_id = sid and a.day = extract(isodow from d)::int - 1
      and a.can_study and st >= a.start_minute and st + dur <= a.end_minute) then raise exception 'Outside availability'; end if;
    if exists(select 1 from public.study_tasks t where t.student_id = sid and t.scheduled_date = d
      and t.start_minute < st + dur and st < t.start_minute + t.planned_minutes) then raise exception 'Tasks overlap'; end if;
    insert into public.study_tasks(plan_id,student_id,lesson_id,assessment,subject,topic,scheduled_date,start_minute,planned_minutes,activity)
      values(pid,sid,c.id,assessment_code,c.subject,c.lesson_name,d,st,dur,entry->>'activity');
  end loop;
  return pid;
end $$;

create function public.consume_ai_budget() returns boolean language plpgsql security definer set search_path = '' as $$
declare daily int; minute_count int; begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  insert into private.ai_usage(user_id,bucket,count) values(auth.uid(),'day:' || (now() at time zone 'Asia/Dubai')::date,1)
    on conflict(user_id,bucket) do update set count = private.ai_usage.count + 1 returning count into daily;
  insert into private.ai_usage(user_id,bucket,count) values(auth.uid(),'minute:' || to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24:MI'),1)
    on conflict(user_id,bucket) do update set count = private.ai_usage.count + 1 returning count into minute_count;
  return daily <= 40 and minute_count <= 5;
end $$;

-- Only the backend's service role can create trusted AI messages/questions.
create function public.save_exchange(cid uuid, sid text, owner_id uuid, lesson text, user_text text, assistant_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.conversations where id = cid and (student_id <> sid or author_id <> owner_id or lesson_id <> lesson))
    then raise insufficient_privilege; end if;
  insert into public.conversations(id,student_id,lesson_id,author_id) values(cid,sid,lesson,owner_id) on conflict(id) do nothing;
  insert into public.messages(conversation_id,student_id,role,content) values(cid,sid,'user',user_text),(cid,sid,'assistant',assistant_text);
  return cid;
end $$;
create function public.save_ai_questions(sid text, lesson text, questions jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare entry jsonb; qid uuid; begin
  for entry in select * from jsonb_array_elements(questions) loop
    insert into public.practice_questions(student_id,lesson_id,prompt,choices,source)
      values(sid,lesson,entry->>'prompt',entry->'choices','ai') returning id into qid;
    insert into private.answer_keys values(qid,(entry->>'correct_index')::int,entry->>'explanation');
  end loop;
end $$;

-- Explicit EXECUTE allowlists prevent Postgres' default PUBLIC function access.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.complete_task(uuid), public.submit_answer(uuid,integer), public.set_availability(text,jsonb),
  public.save_exam(text,text,text,text,date,date), public.add_question(text,text,text,jsonb,integer,text),
  public.save_weekly_plan(text,text,date,integer,jsonb,jsonb), public.consume_ai_budget(), public.set_preferences(text,integer,jsonb), public.review_answer(uuid) to authenticated;
grant execute on function public.save_exchange(uuid,text,uuid,text,text,text), public.save_ai_questions(text,text,jsonb) to service_role;
revoke all on function private.is_parent(), private.can_access(text) from public, anon;

create index on public.curriculum(grade,assessment);
create index on public.exams(student_id,start_date);
create index on public.availability(student_id,day);
create index on public.materials(student_id,subject);
create index on public.study_tasks(student_id,scheduled_date);
create index on public.practice_questions(student_id,lesson_id);
create index on public.practice_attempts(student_id,submitted_at);
create index on public.conversations(student_id,author_id);
create index on public.messages(conversation_id,sequence);
create index on public.legacy_records(student_id);
commit;
