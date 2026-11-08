# Spec-Driven Development: GhostPR (AutoFix AI)
# Hackathon: Kiroween 2026 (Sponsored by AWS)

## 1. Goal
Provide a spec-driven pipeline where developers or QA engineers can feed a visual bug recording URL (e.g. QuickCast session `qc_...`) and receive a Playwright reproduction that is proven Red on the live build, a candidate fix proven Green on a local build of the fix branch, and a Pull Request containing both the regression test and the fix.

## 2. Requirements & Invariants
- [x] **REQ-1 (Ingestion):** Stream and cache video `.webm` from Cloudflare R2 with zero server GPU overhead.
- [x] **REQ-2 (Telemetry):** Extract keyframes and parse interaction markers (clicks, inputs, URLs).
- [x] **REQ-3 (Test Synthesis):** Synthesize executable Playwright test specs (`tests/repro_<id>.spec.ts`).
- [x] **REQ-4 (Codebase Diagnosis):** Search repository source files for selector tokens and failing lines.
- [x] **REQ-5 (Closed-Loop Verification):** Capture the candidate defensive patch from the target repo's git (agent- or developer-authored on `fix/ghost-pr-<id>`), serve the patched build locally, and confirm the same reproduction spec turns Red ➔ Green with Playwright. Green is never reported without a real passing run.
- [x] **REQ-6 (PR Dispatch):** Create git branch `fix/ghost-pr-<id>`, commit diff + spec, and generate structured PR description.
- [x] **REQ-7 (Visual HTML Report):** Generate a standalone, self-contained interactive HTML reproduction report in `artifacts/report.html` containing video keyframes, Red Playwright test logs, Green verification proof, and a colorized unified diff. Local filesystem paths are redacted from the report.
- [ ] **REQ-8 (Autonomous Patch Synthesis):** Generate the defensive patch itself from the Red failure (failing step, selector, and source location), then hand it to the REQ-5 verification loop. *(Roadmap)*

## 3. Supported Technologies
- Playwright E2E Test Runner (`@playwright/test`)
- Node.js ES Modules (`node:util`, `node:child_process`, `node:fs`, `node:http`) and native `fetch()`
- GitHub REST API (`octokit`)
- Kiro steering and spec-driven development
