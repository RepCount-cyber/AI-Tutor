# AI-Tutor

Ai tutor for learning.

This repository contains the Family Tutor MVP application for a shared-family study workflow: parent + child profiles, PT2 planning, study tracking, file uploads, and Jarvis side-panel support.

## Project status

This package is not a public deployment. It is a local source project being validated and prepared for deployment after real Neon and Google auth verification.

## Included

- Shared family Google sign-in with a single allowlisted account and no PINs
- Independent profile selection per device, with child and parent profiles
- PT2 planning and assessment-wide weekly scheduling
- Study tasks, timers, offline study separation, and progress tracking
- School-material uploads with content-hash checks and private storage handling
- Jarvis chat/voice panel support and a standalone preview mode

## Local run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Validation

```bash
npm run build
npm test
```

## Documentation

- SETUP.md — setup and migration guidance
- docs/AI_CONNECTION.md — AI provider guidance
- docs/VALIDATION.md — live validation checklist
- AGENTS.md and PROJECT_STATUS.md — project handoff and ongoing status

## Notes

The project is intentionally designed to keep preview/demo data separate from live records and to preserve real enrolled student data without inventing production records.
