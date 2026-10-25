-- Run AFTER 001 in the Supabase SQL editor. All test data is rolled back.
-- This file has not been executed in the offline build environment.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','test-parent@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','test-child-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','test-child-b@example.invalid');
insert into public.profiles values
 ('10000000-0000-4000-8000-000000000001','Test parent','parent'),
 ('10000000-0000-4000-8000-000000000002','Test A','child'),
 ('10000000-0000-4000-8000-000000000003','Test B','child');
insert into public.students(id,display_name,grade) values('__test_a','Test A','Test grade'),('__test_b','Test B','Test grade'),('__test_outside','Outside','Test grade');
insert into public.student_accounts values('10000000-0000-4000-8000-000000000002','__test_a'),('10000000-0000-4000-8000-000000000003','__test_b');
insert into public.parent_students values('10000000-0000-4000-8000-000000000001','__test_a'),('10000000-0000-4000-8000-000000000001','__test_b');
insert into public.assessments(code,name) values('__test','Test assessment');
insert into public.curriculum(id,source_id,grade,subject,lesson_name,assessment) values('__test_lesson','test','Test grade','Test subject','Test topic','__test');
insert into public.practice_questions(id,student_id,lesson_id,prompt,choices,source) values
 ('20000000-0000-4000-8000-000000000001','__test_a','__test_lesson','Test question','["Wrong", "Right"]','parent'),
 ('20000000-0000-4000-8000-000000000002','__test_b','__test_lesson','Private question','["Wrong", "Right"]','parent');
insert into private.answer_keys values('20000000-0000-4000-8000-000000000001',1,'Test explanation'),('20000000-0000-4000-8000-000000000002',1,'Test explanation');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.students where id like '__test_%') <> 1 then raise exception 'FAIL: child sees other student records'; end if;
  if (select count(*) from public.practice_questions where lesson_id = '__test_lesson') <> 1 then raise exception 'FAIL: child sees other questions'; end if;
  begin update public.profiles set role = 'parent' where id = auth.uid(); raise exception 'FAIL: child escalated role'; exception when insufficient_privilege then null; end;
  begin perform * from private.answer_keys; raise exception 'FAIL: answer keys exposed'; exception when insufficient_privilege then null; end;
  begin perform public.review_answer('20000000-0000-4000-8000-000000000001'); raise exception 'FAIL: unanswered key exposed through feedback'; exception when insufficient_privilege then null; end;
  begin perform public.set_availability('__test_b','[]'); raise exception 'FAIL: child changed availability'; exception when insufficient_privilege then null; end;
  begin perform public.submit_answer('20000000-0000-4000-8000-000000000002',1); raise exception 'FAIL: child answered for another student'; exception when insufficient_privilege then null; end;
  begin perform public.save_exchange(gen_random_uuid(),'__test_a',auth.uid(),'__test_lesson','q','forged assistant'); raise exception 'FAIL: client forged assistant response'; exception when insufficient_privilege then null; end;
  if (public.submit_answer('20000000-0000-4000-8000-000000000001',0)->>'correct')::boolean then raise exception 'FAIL: wrong answer marked correct'; end if;
  if (public.submit_answer('20000000-0000-4000-8000-000000000001',1)->>'correct')::boolean then raise exception 'FAIL: replay changed original grade'; end if;
  if (public.review_answer('20000000-0000-4000-8000-000000000001')->>'correct_index')::int <> 1 then raise exception 'FAIL: saved feedback unavailable after answer'; end if;
  raise notice 'PASS: child isolation, role protection, hidden answers, trusted writes and first-answer grading';
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.students where id like '__test_%') <> 2 then raise exception 'FAIL: parent scope is wrong'; end if;
  if exists(select 1 from public.students where id = '__test_outside') then raise exception 'FAIL: parent sees an unlinked student'; end if;
  perform public.set_availability('__test_a','[{"day":0,"start_minute":960,"end_minute":990,"can_study":true}]');
  if not exists(select 1 from public.availability where student_id = '__test_a') then raise exception 'FAIL: authorized parent write failed'; end if;
  begin perform public.set_availability('__test_outside','[]'); raise exception 'FAIL: parent wrote to an unlinked student'; exception when insufficient_privilege then null; end;
  raise notice 'PASS: parent can manage linked children only';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.students; raise exception 'FAIL: anonymous read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.consume_ai_budget(); raise exception 'FAIL: anonymous RPC allowed'; exception when insufficient_privilege then null; end;
  raise notice 'PASS: anonymous reads and writes denied';
end $$;
reset role;
rollback;
