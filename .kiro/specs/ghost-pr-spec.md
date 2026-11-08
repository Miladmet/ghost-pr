# Spec-Driven Development: GhostPR (AutoFix AI)
# Hackathon: Kiroween 2026 (Sponsored by AWS)

## 1. Goal
Provide a hands-off, automated pipeline where developers or QA engineers can feed any visual bug recording URL (e.g. QuickCast session `qc_...`) and receive a verified, passing GitHub Pull Request containing both the regression test and the source fix.

## 2. Requirements & Invariants
- [x] **REQ-1 (Ingestion):** Stream and cache video `.webm` from Cloudflare R2 with zero server GPU overhead.
- [x] **REQ-2 (Telemetry):** Extract keyframes and parse interaction markers (clicks, inputs, URLs).
- [x] **REQ-3 (Test Synthesis):** Synthesize executable Playwright test specs (`tests/repro_<id>.spec.ts`).
- [x] **REQ-4 (Codebase Diagnosis):** Search repository source files for selector tokens and failing lines.
- [x] **REQ-5 (Self-Healing Loop):** Apply defensive AST patches and confirm green status with Playwright.
- [x] **REQ-6 (PR Dispatch):** Create git branch `fix/ghost-pr-<id>`, commit diff + spec, and generate structured PR description.
- [x] **REQ-7 (Visual HTML Report):** Generate a standalone, self-contained interactive HTML reproduction report in `artifacts/report.html` containing video keyframes, Red Playwright test logs, Green verification proof, and a colorized unified diff.

## 3. Supported Technologies
- Playwright E2E Test Runner (`@playwright/test`)
- Node.js ES Modules (`node:util`, `node:child_process`, `node:fs`)
- GitHub REST API (`octokit`)
- Kiro CLI & Custom Agent Hooks
