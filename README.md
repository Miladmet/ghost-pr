# GhostPR (AutoFix AI)
> **Autonomous Visual Bug Reproduction to Passing Git Pull Request**  
> *Built for Kiroween Hackathon 2026*

---

## 🛠️ Required Tooling & Architecture Stack

### 1. Ingestion & Visual Telemetry
- **Input:** QuickCast Recording (`.webm` / Cloudflare R2 watch URL) or standard screen video.
- **Frame & Audio Extractor:** `imageio-ffmpeg` / `ffmpeg` (local binary, zero cloud GPU).
- **DOM Event Log:** Interaction markers (URLs visited, selectors clicked, network requests).

### 2. Autonomous Reproduction Engine
- **Test Runner:** `@playwright/test` (Headless Chromium, Firefox, WebKit).
- **Reproduction Synthesizer:** Auto-generates `tests/repro_<session_id>.spec.ts`.

### 3. Codebase Analysis & Patching Engine
- **File Locator:** AST and regex search matching error stacks & DOM selectors against source code.
- **Diff Generator:** `git diff` patch creator.
- **Self-Healing Loop:** Runs Playwright test $\rightarrow$ verifies failure on unpatched code $\rightarrow$ applies patch $\rightarrow$ confirms test passes (green).

### 4. Git Version Control & PR Dispatch
- **GitHub / GitLab API:** `octokit` (creates branch `fix/ghost-pr-<id>`, commits code + spec, opens PR with video timestamps and test pass proof).

---

## 📂 Project Structure

```text
ghost-pr/
├── package.json
├── README.md
├── src/
│   ├── ingest.js         # Parses QuickCast video & markers
│   ├── synth-test.js     # Generates reproducible Playwright spec
│   ├── code-fixer.js     # Analyzes repo & writes bug fix
│   ├── git-pr.js         # Opens branch and Pull Request
│   └── cli.js            # Command-line interface
├── templates/            # Playwright & PR markdown templates
└── tests/                # Generated reproduction test specs
```
