# Family Tutor AI Agent Handoff

This directory is the shared handoff location for the Family Tutor project. Any AI agent working on this project must read this file first and then continue from the current status in PROJECT_STATUS.md.

Project work root:
- C:\ApplicationTeam\DEV\AI tutor\Family_Tutor_MVP\family-tutor

Important rules:
- Read this file and PROJECT_STATUS.md before making changes.
- Preserve the existing working Neon configuration, .neon state, environment variables, and unrelated settings.
- Do not overwrite working configuration wholesale.
- Do not claim migration, deployment, authentication, or end-to-end success without evidence.
- Do not print secrets, tokens, OAuth URLs, passwords, connection strings, or private student data.
- Never invent production student records or exam dates.
- Keep real data and preview/demo data separate.
- Only install missing tool/plugin components when required; do not duplicate Neon or MCP components that already exist.
- Use the project’s local build/test flows before claiming the app is healthy.
- Always update this file and PROJECT_STATUS.md after major milestones or when the project state changes.

Current work context:
- This is a JavaScript ES-module app with public/, api/, lib/, db/, scripts/, tests/ and a separate preview/build flow.
- The app is being migrated from Supabase-specific assumptions toward a live Neon-backed configuration while preserving the family learning features.
- Local verification is complete enough to say the app builds and the local test suite passes.
- Neon remote project authentication and live infrastructure inspection have now succeeded, and the database plus private object storage were both validated against the live project with disposable verification data.
- The remaining incomplete piece is the family Google account auth flow and final production configuration; the underlying Neon Postgres and Object Storage connection itself is confirmed.
- The exact blocker at this point is the final browser-based Google OAuth completion. The local app, redirect, and callback route are fixed, but the actual family-account sign-in still has to be completed in a real browser session before a public launch decision can be made.

Project state summary:
- Local build status: passing.
- Local test status: passing (77/77).
- Remote Neon project state: authenticated and validated.
- Live DB + object storage verification: successful using temporary verification records and cleanup.
- App startup: successful locally with .env.local loaded.
- Final family Google account allowlist: configured for saleemdbest@gmail.com.
- Google sign-in redirect: confirmed working from /api/google/start.
- Neon skills / MCP plugin: already installed and verified; no duplicate install performed.
- Vercel deployment: not claimed; remote production auth/config still needs final completion.

Required workflow for future AI agents:
1. Check this file and PROJECT_STATUS.md.
2. Validate the real local project path and package.json.
3. Run the smallest relevant build/test check. Do not rely on old passing tests as proof of remote integration.
4. Preserve the project’s current configuration and only change what is necessary.
5. If Neon auth or remote state is needed, complete the real browser auth flow first and inspect the actual remote state.
6. Update PROJECT_STATUS.md with the latest verified state and blockers before finishing.

Do not modify this file casually; treat it as the project’s live operating handbook.
