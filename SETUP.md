# Setup — shared Google login, no PINs

Complete each stage and verify it before moving on. Never paste private keys into chat or put credentials/CSV exports in GitHub.

## 1. Create a new Supabase project

Run these SQL files in order in its SQL editor:

1. `db/001_family_tutor.sql` — original tables and checked operations.
2. `db/003_family_learning.sql` — shared-family learning, timers, uploads and question types.
3. `db/004_family_security_checks.sql` — transactional acceptance checks, with all fixture data rolled back.

Do not run the old `002_security_checks.sql` after the new upgrade; it describes the earlier separate-child-account model. File 001 is for a new database and must not be blindly rerun over an existing installation. If the earlier package was already installed, back it up and run only 003 plus 004 after reviewing migration scope.

The SQL checks could not be executed against a live Supabase project here. Resolve any error before adding real records.

The private `family-materials` storage bucket is created by 003. It accepts PDF, PNG, JPEG, WebP and text up to 2 MB. Do not make it public.

## 2. Configure private environment values

Copy `.env.example` to `.env.local` and fill in privately:

- `APP_ORIGIN=http://localhost:3000` locally; the exact final HTTPS origin on Vercel.
- `SUPABASE_URL`: your project's HTTPS URL.
- `SUPABASE_ANON_KEY`: the legacy Supabase anon key supported by this implementation.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only legacy service_role key. Never expose it to the browser.
- `FAMILY_GOOGLE_EMAIL`: the one Gmail/Google account permitted to enter this family space.
- Leave `AI_PROVIDER=disabled` until the permitted model-service arrangement is settled.

The service key is used for reviewed imports and trusted application writes after server authorization. Regular reads use the verified family user's token and RLS.

## 3. Import existing student records

Export the real Students tab as UTF-8 `imports/Students.csv`. Supported columns include `student_id`, `student_name` or the original `name`, and `grade`; optional `age` and `attention_span_minutes` are supported. The app does not seed or guess real student names or IDs.

Other existing tabs may be exported as described in `docs/MIGRATION.md`.

```bash
node --env-file-if-exists=.env.local scripts/import.mjs --dir ./imports
```

Review failures and warnings. Then, after a clean dry-run:

```bash
node --env-file-if-exists=.env.local scripts/import.mjs --dir ./imports --apply
```

No writes occur without `--apply`. Imports are stable-ID batches, not one transaction; rerun the same reviewed input if a later batch fails. Historical marks are preserved as source data, not invented new quiz scores.

## 4. Prepare PT2 and the routine

```bash
npm run pt2:check
node --env-file-if-exists=.env.local scripts/prepare-pt2.mjs --apply
```

The dry-run prints scope notes. The apply stage requires exactly the two existing Grade 1 and Grade 8 students. It adds PT2 portions only for a grade without existing PT2 curriculum, and adds the suggested routine only when that student has no existing availability. Existing portions/availability are not silently replaced.

The catalog includes Grade 1 Hindi and Grade 8 French based on the supplied timetable and project context. Review the catalog if the enrolled languages differ. Existing source data takes precedence; reconcile it deliberately rather than importing duplicated lesson identities.

No exam dates are inserted. Check the weekend slots and daily targets in Parent → Settings. Saturday madrasa is 08:30–13:00. Proposed weekend study slots are 14:00–15:10, 15:30–16:40 and 20:00–21:10 on Saturday, and 09:00–10:10, 11:00–12:10 and 16:00–17:10 on Sunday. These include breaks; the generated plan should fit 180 actual study minutes each day.

Weekday school/travel times remain editable suggestions from the examples. Verify them against the current routine.

## 5. Enable Google sign-in

In Supabase Auth, enable the Google provider. Create/configure a Google OAuth web client and put its client ID/secret in the Supabase provider settings, not in browser code or chat.

Google's authorized redirect URI is your Supabase project's `/auth/v1/callback` URL. Register the app's local/final origins as required in Google Auth Platform. If the Google consent app is in testing mode, add the family Google account as a test user.

In Supabase Auth URL configuration, set the app Site URL and allow the app callback, including its one-use `flow` query value. For example, use the exact trusted origin followed by `/api/google/callback**` in the allowed redirect list. Do not allow arbitrary external origins.

The application starts PKCE, stores a short-lived HttpOnly/Lax verifier cookie, exchanges the callback code server-side and verifies the exact allowed Google email/provider. No Gmail-message or Drive-account access scopes are requested: sign-in uses `openid email profile`.

On the first successful login, the server links that verified Google identity as the family owner to the two already-imported students. Do not enable the app for another family in the same single-family project without redesigning this provisioning step. Existing earlier-version account links require deliberate migration; the app does not reset other users' roles.

Use the single Google account on each device, then independently choose the relevant child or Parent. There are no PINs. Anyone signed in can switch to Parent; profile choice organizes the family experience and is not a confidentiality barrier within the household. Direct database access remains limited to the authenticated family.

Sign-out uses `scope=local`, so signing out on one device does not intentionally sign out the others. Do not enable Supabase's Single session per user setting.

## 6. Run and verify

```bash
npm run check
npm test
npm run dev
```

Sign in and check the real names/grades. Choose Parent, review the PT2 portions and availability, and create the weekly plan. Try switching profiles on separate devices.

As a child, choose a portion and start a study timer. Check that hidden/idle/paused time does not continue accumulating, that another device cannot run a simultaneous timer for that child, and that finishing saves the session. Record some offline study and verify it is labelled separately.

Save a portion checklist. Upload a small readable PDF; confirm its subject/portion/text and check it becomes ready. Upload the exact same content under another filename and verify duplicate detection. Try a scanned PDF or image: it must request readable text instead of pretending extraction succeeded.

Assign one parent-created MCQ and submit it through the child profile. Verify the original answer is preserved on replay. With AI configured later, test all four question types and parent review of short answers.

Follow `docs/VALIDATION.md` for live checks, including SQL policies, browser layout and Jarvis microphone controls.

## 7. Deploy to Vercel through private GitHub

Push the app directory to a private GitHub repository, excluding `.env.local`, imports and private account data. Import it into Vercel with framework **Other**, output directory **public**, Node.js 22+, no build command and no required npm install. Keep root `api/` and `lib/` in the repository.

Set the private environment values on Vercel. Set `APP_ORIGIN` to the exact final HTTPS origin, update OAuth callback allowlists, and redeploy. Treat untrusted branch previews as separate test environments; do not give them real family credentials/database access.

Vercel/Supabase integrations were disabled here, so these hosted steps remain unperformed. Review actual account plans/quotas before accepting costs.

## 8. Connect Jarvis's AI service

Read `docs/AI_CONNECTION.md`. A suitably permitted HTTPS model gateway is required for live tutor answers and automatic practice generation. Adding a Gemini key alone does not enable the excluded child-directed Developer API use.

Jarvis uses browser speech recognition/synthesis. Browser support and voice/language availability vary; speech recognition may send audio to the browser vendor's service. It starts only after Speak is pressed. Text chat works without microphone support. HTTPS or localhost and microphone permission are required. Live speech was not tested here.

Keep n8n as a fallback until the new app passes live acceptance with the real records.
