-- Run after 001 + 003 in a test Supabase project. This test rolls all fixtures back.
-- It checks the shared-family model, NOT PIN/private separation between household profiles.
begin;
insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000001','family-test@example.invalid'),('90000000-0000-4000-8000-000000000002','outsider-test@example.invalid');
insert into public.profiles values('90000000-0000-4000-8000-000000000001','Family owner','parent'),('90000000-0000-4000-8000-000000000002','Other owner','parent');
insert into public.students(id,display_name,grade) values('__v2_a','Test A','Test Grade A'),('__v2_b','Test B','Test Grade B'),('__v2_out','Outside','Test Grade C');
insert into public.parent_students values('90000000-0000-4000-8000-000000000001','__v2_a'),('90000000-0000-4000-8000-000000000001','__v2_b'),('90000000-0000-4000-8000-000000000002','__v2_out');
insert into public.assessments(code,name) values('__v2_test','Test');
insert into public.curriculum(id,source_id,grade,subject,lesson_name,assessment) values('__v2_lesson','test','Test Grade A','Test subject','Test topic','__v2_test');
insert into public.practice_questions(id,student_id,lesson_id,prompt,choices,source,kind) values('91000000-0000-4000-8000-000000000001','__v2_a','__v2_lesson','Choose correctly','["Wrong","Right"]','parent','mcq'),('91000000-0000-4000-8000-000000000002','__v2_a','__v2_lesson','Explain','[]','parent','short_answer');
insert into private.answer_keys(question_id,correct_index,explanation,expected_answer,rubric) values('91000000-0000-4000-8000-000000000001',1,'Explanation',null,''),('91000000-0000-4000-8000-000000000002',null,'Answer guide','"Model answer"','Check the main idea');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.students where id in ('__v2_a','__v2_b','__v2_out'))<>2 then raise exception 'FAIL: household read boundary';end if;
  begin perform * from private.answer_keys;raise exception 'FAIL: direct private key read';exception when insufficient_privilege then null;end;
  begin update public.profiles set role='child' where id=auth.uid();raise exception 'FAIL: direct role mutation';exception when insufficient_privilege then null;end;
  begin perform public.set_availability('__v2_out','[]');raise exception 'FAIL: foreign family write';exception when insufficient_privilege then null;end;
  if (public.submit_response('91000000-0000-4000-8000-000000000001','{"choice":0}')->>'correct')::boolean then raise exception 'FAIL: wrong MCQ marked correct';end if;
  if (public.submit_response('91000000-0000-4000-8000-000000000001','{"choice":1}')->>'correct')::boolean then raise exception 'FAIL: replay changed grade';end if;
  if public.submit_response('91000000-0000-4000-8000-000000000002','{"text":"Original response"}')->>'review_status'<>'review_pending' then raise exception 'FAIL: short answer not pending';end if;
  if exists(select 1 from public.practice_attempts where question_id='91000000-0000-4000-8000-000000000002' and correct is not null) then raise exception 'FAIL: unreviewed response got a score';end if;
  perform public.grade_response((select id from public.practice_attempts where question_id='91000000-0000-4000-8000-000000000002'),true,'Correct main idea');
  if not exists(select 1 from public.practice_attempts where question_id='91000000-0000-4000-8000-000000000002' and correct and review_status='parent_reviewed') then raise exception 'FAIL: parent review failed';end if;
  perform public.start_learning('__v2_a','__v2_lesson','92000000-0000-4000-8000-000000000001','test-secret-hash');
  begin perform public.start_learning('__v2_a','__v2_lesson','92000000-0000-4000-8000-000000000002','other-device');raise exception 'FAIL: simultaneous duplicate timer';exception when serialization_failure then null;end;
  raise notice 'PASS: family isolation, protected writes, replay protection, short-answer review, single active timer';
end $$;
reset role;
update public.learning_sessions set last_seen=now()-interval '15 seconds' where id='92000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare result jsonb;begin
  begin perform public.learning_heartbeat('92000000-0000-4000-8000-000000000001','wrong-secret',true,false);raise exception 'FAIL: timer device key not checked';exception when insufficient_privilege then null;end;
  result:=public.learning_heartbeat('92000000-0000-4000-8000-000000000001','test-secret-hash',true,false);
  if (result->>'active_seconds')::int<>15 then raise exception 'FAIL: server elapsed-time accounting';end if;
  result:=public.learning_heartbeat('92000000-0000-4000-8000-000000000001','test-secret-hash',true,false);
  if (result->>'active_seconds')::int<>15 then raise exception 'FAIL: same-timestamp heartbeat counted twice';end if;
  perform public.learning_heartbeat('92000000-0000-4000-8000-000000000001','test-secret-hash',false,true);
  if coalesce((select active_seconds from public.daily_study where student_id='__v2_a' and study_date=(now() at time zone 'Asia/Dubai')::date),-1)<>15 then raise exception 'FAIL: daily total';end if;
  raise notice 'PASS: device-bound heartbeats, server time, replay-safe totals';
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.daily_study where student_id='__v2_a') then raise exception 'FAIL: outsider read daily time';end if;
  begin perform public.submit_response('91000000-0000-4000-8000-000000000001','{"choice":1}');raise exception 'FAIL: outsider submitted answer';exception when insufficient_privilege then null;end;
  raise notice 'PASS: other-family access denied';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.students;raise exception 'FAIL: anonymous data read';exception when insufficient_privilege then null;end;
  begin perform public.start_learning('__v2_a','__v2_lesson',gen_random_uuid(),'bad');raise exception 'FAIL: anonymous timer';exception when insufficient_privilege then null;end;
  raise notice 'PASS: anonymous access denied';
end $$;
reset role;
rollback;
