# Recovered evidence and migration decisions

The app was grounded in previously shared material. It does not claim to contain a fresh copy of the live Sheets database.

## Sources recovered

| Source | Evidence used |
| --- | --- |
| `index(2).html`, uploaded June 26, 2026 | Existing app title, frontend scope, localhost n8n base URL and hardcoded student map. The new app removes that map. |
| `05 Weekly Timetable - Assessment Progress Version (2).json`, uploaded June 26, 2026 | Assessment-wide planning, student/grade filtering, ExamCalendar, MaterialKnowledge, Curriculum, WeeklyAvailability and saved StudySessions. |
| `09%20AI%20Tutor%20Curriculum%20Service%20SAFE.json` | Active curriculum/assessment filtering and curriculum response structure. |
| `ai_tutor_sheet_schema.csv`, June 16, 2026 | Original student, progress, weak-area, study-plan, worksheet and parent-report schema proposal. It differs from later workflow references. |
| Retrieved June 20 project context | Exact Assessment and Curriculum column lists and the rule against invented columns. |

No original exports, source credentials, spreadsheet IDs or real student names are included in this distribution. Historical exports were read as evidence; this distribution does not require old webhook paths.

## Exact recovered schema evidence

**Assessment:** `assessment_code, assessment_name, term, status`.

**Curriculum:** `curriculum_id, lesson_code, grade, subject, category, lesson_name, term, assessment, chapter_no, difficulty, learning_objective, keywords, estimated_hours, status`.

**Original Students proposal:** `student_id, name, grade, age, preferred_style, attention_span_minutes`. Later workflow code reads `student_id, student_name, grade`; the importer accepts the evidenced `name` or `student_name` alias and preserves the actual value. It does not select one of the conflicting names remembered in previous chats.

**WeeklyAvailability fields referenced by the newer workflow:** `student_id, day, time_slot, fixed_activity, can_study`.

**ExamCalendar fields referenced by the newer workflow:** `assessment_code, assessment_name, term, start_date, end_date, status`. Per-student/grade/subject scope, when present in a fresh export, must be reviewed; it is not assumed to have existed.

**StudySessions write schema in the newer export:** `session_id, timetable_id, student_id, student_name, grade, assessment, week_start_date, day, planned_date, start_time, end_time, subject, lesson_code, lesson_name, activity_type, planned_minutes, material_used, status, completion_confirmed_by, quiz_status, score, created_at, updated_at`.

The old schema used `Weak_Areas` and `Parent_Reports`; later workflows used `WeakAreas` and `ParentReports`. The importer recognizes those aliases instead of claiming one original schema remained current.

## Mapping into the NEW database

| Export | New table / handling |
| --- | --- |
| Students | `students`: ID, recorded display name, normalized `Grade N`, age and attention span. Missing focus length gets a documented app default of 25 minutes; it is not represented as an existing preference. |
| Assessment | `assessments`: code, name, term, active status |
| Curriculum | `curriculum`: all supported columns above. Stable new ID uses source curriculum_id **and assessment**. Intentional repeated portions across assessments are retained. |
| ExamCalendar | `exams`: one reviewed student-scoped row per exam/window. ISO dates required. Shared windows require explicit expansion when scope is absent. |
| WeeklyAvailability | `availability`: full weekday names, HH:MM-HH:MM slots and yes/no study flag. Monday becomes day 0 internally. Overlapping slots are rejected. |
| LearningMaterials | `materials`: student_id, drive_file_id, file_name/title, subject and optional assessment/lesson_name/topic/material_type. These are supported import fields, not a claim that every original column was recovered. |
| MaterialKnowledge | Enriches material by **student_id + drive_file_id** with summary/concepts and optional extracted_text/text. Missing identities are flagged; filenames are never used to guess a join. |
| Progress, WeakAreas, Worksheets, ParentReports, StudySessions, Study_Plan and other historical tabs | Retained in `legacy_records` with source tab and untouched source values. Existing historical rows do not become freshly graded quiz attempts. |

Historical WeakAreas flags with an exact subject/lesson-name match can influence planning while new evidence is sparse. They are not converted into invented percentages. Unknown historical identities stop the dry-run.

New study plans, task IDs, authentication profiles, account links, question keys and attempts are **new schema**, defined explicitly by `db/001_family_tutor.sql`. They were not claimed to be pre-existing Sheet columns.

## Preserved project rules

- Drive file ID is the material identity; matching filenames do not imply duplicate content.
- `SST` and `UAE SST` remain different subject strings. No automatic Social Studies mapping is performed.
- No names/grades are hardcoded for live accounts.
- No old n8n webhook paths are invented or modified; the replacement app introduces its own documented API.
- Dates and weekly schedules use Asia/Dubai.
- Import validation is a dry-run unless `--apply` is explicitly used.
- A whole assessment is coordinated across subjects; plans are not separate disconnected lesson timetables.

## Remaining data work

The recovered attachments are not an authenticated live Sheets connection. Real current rows still need to be exported or connected. Image OCR, Google Drive sync and automatic school-portal ingestion are not implemented. Version 2 adds readable PDF text extraction in the browser with family review, private file uploads, content-hash duplicate detection and missing-text flags. The tutor can use imported MaterialKnowledge summaries and extracted text; it does not claim to have read every PDF simply because a Drive link exists.


## Version 2 PT2 data

`data/pt2-2026.json` records 41 PT2 portions from the newly supplied Grade 1 and Grade 8 term-wise PDFs. It retains physical PDF page references. The catalog excludes enrichment and annual portions; NIL and missing PT2 subjects are documented explicitly. `scripts/prepare-pt2.mjs` applies it only where a grade has no existing PT2 portions, after actual student records are imported.

The Saturday madrasa interval (08:30–13:00) and 180-minute school-study targets on Saturday/Sunday are user-supplied constraints. Weekday routines and precise weekend study slots are editable suggestions based on the provided timetable examples. They are not claimed to be a newly issued school exam timetable.
