# Architecture — version 2

Browser → same-origin Vercel Node API → Supabase Auth/Postgres/private Storage. AI calls go only from the backend to the configured permitted gateway. Original Drive materials retain their existing Drive access rules.

## Identity and profiles

The allowlisted Google account is the household identity. Its database profile is Parent and is linked to the two imported students. Each browser has an independent HttpOnly profile-choice cookie. The selected child context narrows API reads/writes and prevents accidental attribution to a different child; Parent can see/manage both. No PIN or private authentication boundary separates profiles, as explicitly requested. The backend verifies family membership on every request. Google/Supabase tokens and the service key are never sent in frontend responses.

The app does not need three email accounts. The old password-login route and three-account provisioning script are retired. Sign-out is local to the current Supabase session.

## New learning data

`lesson_checkins` records per-portion/day confirmations and help requests without changing quiz marks. `learning_sessions` uses server timestamps and a device-bound secret hash; one open timer per child prevents concurrent-device double counting. `daily_study` records active seconds in Asia/Dubai, including splitting a tick across midnight. `offline_study` records separately labelled reported minutes. `portal_checks` records whether the family checked for new school material.

Heartbeats run every 15 seconds. A tick counts at most 30 elapsed seconds and only when both the previous and current state are active. Hidden, paused and 90-second-idle states stop counting. Lost network connections can undercount; an abandoned session is released after two minutes when a new session is started. Active time is an estimate, not proof of concentration. Manual/offline reports are not automatically added to verified active time.

## Material ingestion

Uploads are bounded to 2 MB, sniffed for accepted formats, hashed on the server and stored under an authenticated-family path. Identical bytes for the same child deduplicate, even with a changed filename. Different bytes with identical filenames remain separate. Drive IDs remain supported for imported materials.

PDF.js 5.6.205 legacy-browser modules are vendored with license. Readable PDF text is extracted on the client with page markers; it is user-supplied learning content, not a security-trusted parsing result. The family confirms subject/portion and reviews the text. Missing/scanned content is flagged for pasted text. Image OCR, DOCX parsing and automated school-portal login are not included. `needs_text`/`needs_review` materials are excluded from AI practice generation until corrected and confirmed.

## Practice and evidence

MCQs use a hidden correct index. Fill-in-the-blanks compare accepted strings case-insensitively with normalized whitespace. Matching requires the exact approved mapping. Short answers save a first response and wait for Parent review. Pending responses are excluded from accuracy. AI-generated keys still require educational review: structural validation does not establish factual correctness.

First submissions are preserved against replay. Review endpoints check active profile/student scope. Parent can review both children's keys and grade short answers. Self-confirmed study, practice accuracy and estimated active time are distinct signals.

## Jarvis

A right-hand panel has Chat/Voice tabs, a CSS amber orb, transcript, lesson choice and voice controls. It calls the same authorized tutor endpoint as the main tutor view, using only the selected student's lesson context. Browser speech recognition starts on an explicit Speak click, and synthesis reads a response during the voice interaction. Closing/ending/changing context stops speech. Mute stops the voice session's microphone/speaker activity. No always-listening or wake-word mode is implemented. Browser recognition may use its vendor's online service; it is not promised to run locally/offline.

## New API routes

- GET `/api/google/start`, `/api/google/callback`: server-side Google PKCE.
- GET `/api/session`, POST `/api/profile`: family choices and browser-local selection.
- POST `/api/checklist`, `/api/portal-check`, `/api/offline-study`.
- POST `/api/timer/start`, `/api/timer/tick`.
- POST `/api/material/upload`, GET/POST `/api/material/text`, GET `/api/material/file`.
- POST `/api/response`, `/api/grade`; existing question, feedback, tutor, quiz, plan and parent-setting routes remain.

These are new application routes, not invented old n8n webhooks.

## Limits

No live deployment/auth/storage/model or browser microphone verification was possible here. No automatic background timetable regeneration, push reminders, school-portal scraping or full OCR pipeline is included. Parent changes/results are incorporated when the week is regenerated. The default model budget remains 5 requests per clock minute and 40 per UAE day for the shared Google account, including quizzes/failed calls. Configure budgets deliberately after reviewing costs.
