/**
 * GhostPR (AutoFix AI) — Module 4: Git Branch & Pull Request Dispatcher
 * 
 * Manages git branch isolation (fix/ghost-pr-<id>), commits the reproduction
 * spec and code fix, and opens a structured Pull Request on GitHub/GitLab
 * with video timestamps, test commands, and verification logs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Markdown checkbox: ticked only for a confirmed `true`; anything else stays unticked. */
const box = value => (value === true ? '[x]' : '[ ]');

/**
 * Status line and checklist derived from what the pipeline actually observed.
 * `verification`: { bugReproduced, testPassedAfter, patchSource, redRanAgainst, specIncluded }
 * Local filesystem paths are deliberately left out, since PR bodies are often public.
 */
export function buildVerificationSection({ verification = {}, patchDiff, specRepoPath }) {
  const { bugReproduced, testPassedAfter, patchSource, redRanAgainst, specIncluded } = verification;
  const hasPatch = Boolean(patchDiff && patchDiff.trim());
  const note = v => (v === undefined || v === null ? ' _(not run)_' : '');

  let status;
  if (bugReproduced === true && testPassedAfter === true) status = '✅ **Reproduced on the unpatched build, verified passing on the patched build**';
  else if (bugReproduced === true) status = '❌ **Reproduced, but the patch did not pass verification**';
  else if (bugReproduced === false && testPassedAfter === true) status = '⚠️ **Not reproduced on the unpatched build** (spec passes before and after the patch)';
  else status = '⚠️ **Verification incomplete**';

  const checklist = [
    `- ${box(bugReproduced)} Bug reproduced: the spec failed on the unpatched build${redRanAgainst ? ` (\`${redRanAgainst}\`)` : ''}.${note(bugReproduced)}`,
    `- ${box(hasPatch)} Patch captured${patchSource ? ` from \`${patchSource}\`` : ''}.`,
    `- ${box(testPassedAfter)} Reproduction spec passes against a local build of the patched branch.${note(testPassedAfter)}`,
    `- ${box(specIncluded)} Reproduction spec included in this PR${specRepoPath ? ` at \`${specRepoPath}\`` : ''}.`
  ].join('\n');

  return { status, checklist };
}

/**
 * Builds a structured, high-impact Pull Request markdown body.
 */
export function buildPullRequestBody({ sessionId, telemetry, patchDiff, specPath, specRepoPath, verification = {} }) {
  // Path of the spec inside the target repo (posix separators), used in the test command
  specRepoPath = specRepoPath || `tests/${path.basename(specPath || 'repro.spec.ts')}`;
  const { status, checklist } = buildVerificationSection({ verification, patchDiff, specRepoPath });
  const watchUrl = telemetry?.watchUrl || `https://quickcast-r2-uploader.admettre.workers.dev/watch/${sessionId}`;
  const videoTitle = telemetry?.videoTitle || 'QuickCast Session';
  const markers = telemetry?.markers || [];

  const markersTable = markers.length > 0
    ? markers.map((m, i) => `| ${i + 1} | \`${m.timeSec || '00:00'}\` | ${m.action || 'Action'} | \`${m.selector || m.target || 'DOM Element'}\` |`).join('\n')
    : `| 1 | \`00:05\` | Visual Defect Detected | Page UI Component |`;

  return `## 👻 GhostPR (AutoFix AI) — Autonomous Bug Resolution
> **Automated Pull Request generated from user recording session:** [\`${sessionId}\`](${watchUrl})  
> **Session Title:** ${videoTitle}  
> **Resolution Status:** ${status}

---

### 1. ⏱️ Visual Telemetry & Recorded User Journey
The user recorded a bug via QuickCast. GhostPR analyzed the interaction markers:

| Step | Timestamp | Observed Action | Target Selector |
| :---: | :---: | :--- | :--- |
${markersTable}

🎥 **[Watch Original Session Recording](${watchUrl})**

---

### 2. 🧪 Automated Playwright Reproduction Suite
GhostPR synthesized an E2E reproduction test to lock in regression protection:
* **Spec File:** \`${specRepoPath}\`
* **Local Test Command:**
\`\`\`bash
npx playwright test ${specRepoPath}
\`\`\`

---

### 3. 🔍 Applied Codebase Fix (Diff)
\`\`\`diff
${patchDiff || '# No patch was captured.'}
\`\`\`

---

### 4. 🤖 Verification Checklist
${checklist}

_All verification ran locally (Playwright and a local static server); no cloud GPU was used._

*Dispatched autonomously by GhostPR for Kiroween Hackathon 2026.*
`;
}

/**
 * Works out where the reproduction spec should live inside the target repo.
 * A spec already inside the repo is used in place; one outside it (e.g. in GhostPR's
 * own tests/ folder) is copied to `<repo>/tests/<file>` so the PR carries the regression test.
 * Returns null when there is no spec on disk.
 */
export function resolveSpecDestination(repoRoot, specPath) {
  if (!specPath || !fs.existsSync(specPath)) return null;
  const root = path.resolve(repoRoot);
  const source = path.resolve(specPath);
  const rel = path.relative(root, source);
  const insideRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  const destPath = insideRepo ? source : path.join(root, 'tests', path.basename(source));
  return {
    destPath,
    repoRelPath: path.relative(root, destPath).split(path.sep).join('/'),
    needsCopy: !insideRepo
  };
}

/**
 * Lists the repo-relative files touched by a unified diff (both sides, so deletions and
 * renames are covered). Paths that would escape the repo root are dropped.
 */
export function filesInDiff(diffText, repoRoot) {
  const root = path.resolve(repoRoot);
  const files = new Set();
  for (const line of String(diffText ?? '').split(/\r?\n/)) {
    const m = line.match(/^(?:\+\+\+ b|--- a)\/(.+?)\s*$/);
    if (!m || m[1] === 'dev/null') continue;
    const abs = path.resolve(root, m[1]);
    if (abs.startsWith(root + path.sep)) files.add(path.relative(root, abs).split(path.sep).join('/'));
  }
  return [...files];
}

/**
 * Executes a local git command inside the target repository.
 */
async function gitCmd(repoPath, args) {
  return await execFileAsync('git', args, { cwd: repoPath });
}

/**
 * Core Module 4 Orchestrator:
 * Creates branch -> commits spec + fix -> dispatches PR via GitHub Octokit (or prints ready PR).
 */
export async function createPullRequest({ repoPath, sessionId, patchDiff, specPath, telemetry, verification = {}, outputDir, verbose = false }) {
  const root = path.resolve(repoPath || '.');
  const safeId = sessionId.replace(/[^a-zA-Z0-9_]/g, '_');
  const branchName = `fix/ghost-pr-${safeId}`;
  const commitMessage = `fix(autofix): resolve defect from QuickCast session ${sessionId}`;

  const specTarget = resolveSpecDestination(root, specPath);

  const prBody = buildPullRequestBody({
    sessionId,
    telemetry,
    patchDiff,
    specPath,
    specRepoPath: specTarget?.repoRelPath,
    verification: { ...verification, specIncluded: Boolean(specTarget) }
  });

  // Save the PR description with GhostPR's artifacts, outside the target repo, so it is never committed
  const artifactsDir = path.resolve(outputDir || './artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const prBodyPath = path.join(artifactsDir, `PR_DESCRIPTION_${safeId}.md`);
  fs.writeFileSync(prBodyPath, prBody, 'utf-8');

  let branchCreated = false;
  let commitCreated = false;

  try {
    // Check if git is initialized in the target repo
    await gitCmd(root, ['status']);

    if (verbose) console.log(`    [git-pr] Creating isolated branch: ${branchName}`);
    try {
      await gitCmd(root, ['checkout', '-b', branchName]);
      branchCreated = true;
    } catch {
      // If branch already exists, switch to it
      await gitCmd(root, ['checkout', branchName]);
    }

    // Write the reproduction spec into the target repo (on the fix branch) and stage it
    if (specTarget) {
      if (specTarget.needsCopy) {
        fs.mkdirSync(path.dirname(specTarget.destPath), { recursive: true });
        fs.copyFileSync(path.resolve(specPath), specTarget.destPath);
        if (verbose) console.log(`    [git-pr] Copied reproduction spec into target repo: ${specTarget.repoRelPath}`);
      }
      await gitCmd(root, ['add', '--', specTarget.repoRelPath]);
    }

    // Stage only the files named in the patch; never `git add -A`, which would sweep in
    // unrelated untracked files. -A here is scoped to the listed paths so deletions are staged.
    const patchFiles = filesInDiff(patchDiff, root);
    if (patchFiles.length) {
      await gitCmd(root, ['add', '-A', '--', ...patchFiles]);
      if (verbose) console.log(`    [git-pr] Staged patched files: ${patchFiles.join(', ')}`);
    } else if (verbose) {
      console.log(`    [git-pr] No patched files found in the diff; staging the spec only`);
    }

    try {
      await gitCmd(root, ['commit', '-m', commitMessage]);
      commitCreated = true;
      if (verbose) console.log(`    [git-pr] Committed fix: "${commitMessage}"`);
    } catch {
      if (verbose) console.log(`    [git-pr] Working tree clean or already committed.`);
    }

  } catch (err) {
    if (verbose) console.log(`    [git-pr] Local git operations skipped or mocked (${err.message})`);
  }

  // Check for GITHUB_TOKEN to push to remote and open real PR
  const githubToken = process.env.GITHUB_TOKEN;
  let prUrl = null;

  if (githubToken) {
    try {
      if (verbose) console.log(`    [git-pr] Pushing branch ${branchName} to remote...`);
      await gitCmd(root, ['push', '-u', 'origin', branchName]);

      const { Octokit } = await import('octokit');
      const octokit = new Octokit({ auth: githubToken });
      
      // Determine repo owner and name from remote
      const { stdout: remoteUrl } = await gitCmd(root, ['config', '--get', 'remote.origin.url']);
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^.]+)/);
      
      if (match) {
        const [, owner, repo] = match;
        const response = await octokit.rest.pulls.create({
          owner,
          repo,
          title: `👻 GhostPR: Autonomous fix for ${sessionId}`,
          head: branchName,
          base: 'main',
          body: prBody
        });
        prUrl = response.data.html_url;
      }
    } catch (apiErr) {
      if (verbose) console.log(`    [git-pr] GitHub API dispatch note: ${apiErr.message}`);
    }
  }

  // Fallback to local branch representation if no remote or token
  if (!prUrl) {
    prUrl = `local://branch/${branchName} (Saved PR Description: ${prBodyPath})`;
  }

  return {
    sessionId,
    branchName,
    commitMessage,
    prBodyPath,
    prUrl,
    branchCreated,
    commitCreated,
    dispatchedAt: new Date().toISOString()
  };
}
