# Validation — version 2

Run `npm run check` and `npm test`. The test command rebuilds the standalone preview first. BUILD_REPORT.txt records the final outcome.

Local automated tests cover: shared Google allowlisting, PKCE setup, local profile cookies, no-PIN profile switching, stale-profile rejection, family-scoped authorization mocks, no-secret responses, origin checks, private path denial, timer request trust boundaries, content-hash duplicate identities, unsupported/large upload rejection, new question schemas, pending-result exclusion, checklist/score separation, PT2 source scope, and both grades' 180-minute weekend plans with madrasa protected.

The standalone preview is compiled and executed in a Node VM with a minimal document model to test startup, all screens, profile selection and opening Jarvis. These are JavaScript/markup checks, NOT a browser layout or microphone test.

The vendored PDF engine was also exercised against text from the two supplied portion PDFs. Grade 1 physical page 2 and Grade 8 physical page 3 produced the expected Mathematics portion text. This does not prove extraction accuracy for every school PDF, scan, formula or language; reviewed text and missing-page notices remain required.

## Still unverified

- SQL migrations/RLS/timer functions against a real Supabase database.
- Google OAuth/callback/token refresh in real accounts.
- Storage upload/download and live data migration.
- Vercel production routing/configuration.
- Live permitted model calls, generated-question quality or learning effectiveness.
- Real browser layout, touch/keyboard flows and microphone/speech support.

## Live acceptance

1. Run 001, 003 and 004 in a new test project. All transactional SQL checks must pass.
2. Import the two real student records. Apply/review the PT2 catalog and routine; no exam dates should be invented.
3. Sign in with the one permitted Google account. Verify another Google email is rejected. Choose each profile without a PIN.
4. Use three browsers/devices simultaneously with different profiles. Switching/signing out on one must not change or sign out the others.
5. Verify selected-child requests cannot accidentally save to the other child. Verify Parent can intentionally manage both and that no unrelated family is readable through REST/RPC/storage.
6. Create a week plan, confirm Saturday madrasa has no overlap, and inspect the 180 net minutes on each weekend day. Confirm completed/started work survives regeneration.
7. Start a lesson timer, hide/pause/idle the tab and inspect saved seconds. Start on another device for the same child; verify prevention. Test two children studying concurrently. Test a stale browser and a midnight boundary.
8. Save a checklist, report offline study, and verify neither operation manufactures quiz marks or active seconds.
9. Upload readable PDF/text; review extracted text/subject/portion and download the private original. Retry identical content with a renamed file, then different content with the same name. Verify correct duplicate handling.
10. Upload a scanned/image file. It must request readable text, not claim successful OCR. Materials needing review must not ground generated practice.
11. Assign an MCQ, submit through the child profile and replay it; the first response must remain. With the permitted gateway enabled, test blanks, matching and short answers. Pending short answers must not lower accuracy before Parent grades them.
12. Open Jarvis on desktop and phone. Test Chat, explicit microphone permission, Listen, Mute, End, close, changing profiles/lessons, browser denial and unsupported speech. No microphone should start on page load. Check actual language/voice availability and browser-vendor speech data handling.
13. Inspect approximately 390px, 768px and 1440px layouts, keyboard focus, field labels, upload errors, scrolling navigation and the Jarvis overlay. Respect reduced-motion preferences.
14. Compare dashboard totals to source records, and keep the old n8n app as fallback until all checks pass.
