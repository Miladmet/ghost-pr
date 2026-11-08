# Kiro Steering Document: GhostPR (AutoFix AI)
# Category: Frankenstein (Browser Video + Playwright + Kiro Agent + Git PR)

## System Identity & Objective
GhostPR is a spec-driven engineering agent that turns user screen recordings (via QuickCast) into reproducible Playwright E2E tests, and verifies candidate fixes in a closed Red ➔ Green loop before any Pull Request is opened.

## Architectural Directives
1. **Zero Cloud GPU / Zero Compute Waste:**
   - All visual and video frame ingestion executes locally via lightweight WebAssembly or local FFmpeg. Never spin up costly remote rendering clusters.
2. **Deterministic Time Sync:**
   - Anchor all interaction steps to monotonic `performance.now()` timestamps captured during the user session.
3. **Spec-Driven Reproduction:**
   - Playwright reproduction tests must follow modern scoped `test.step()` syntax, asserting visual and DOM invariants.
4. **Defensive Self-Healing Loop:**
   - When generating code patches, always favor defensive guards (optional chaining, null boundaries, state fallbacks) before altering core business logic.
   - Run the Playwright spec to verify that the fix turns the suite from red (failing) to green (100% passing).
5. **Git Hygiene:**
   - Always isolate automated fixes inside branches formatted as `fix/ghost-pr-<session_id>`.
   - Never commit sensitive keys, secrets, or `.env` credentials to version control.
