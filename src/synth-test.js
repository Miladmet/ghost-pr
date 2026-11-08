/**
 * GhostPR (AutoFix AI) — Module 2: Playwright Reproduction Test Synthesizer
 * 
 * Takes ingested QuickCast telemetry, interaction markers, and visual cues,
 * automatically synthesizing an executable Playwright reproduction spec (repro_<id>.spec.ts).
 * Runs the test to confirm that it accurately reproduces the bug/state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Marker emitted by generatePlaywrightSpecCode when it has no interaction steps to work from.
const DEFAULT_SEQUENCE_MARKER = '// Default session reproduction sequence';
const GHOSTPR_TESTS_DIR = fileURLToPath(new URL('../tests/', import.meta.url));
const GHOSTPR_ROOT = fileURLToPath(new URL('../', import.meta.url));
// Gitignored scratch dir inside GhostPR where out-of-tree specs are executed (no Playwright config here)
export const GHOSTPR_RUN_DIR = path.join(GHOSTPR_ROOT, 'artifacts', '.runs');

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Returns true when a spec on disk is a refined reproduction worth keeping:
 * it has at least one test.step() and is not the shallow default fallback.
 */
export function isRefinedSpec(content) {
  return /test\.step\(/.test(content) && !content.includes(DEFAULT_SEQUENCE_MARKER);
}

/**
 * Looks for an existing refined spec for this session, in priority order:
 * the target repo's tests/ folder, then GhostPR's own tests/ folder.
 */
export function findRefinedSpec(specFilename, repoPath) {
  const candidates = [
    path.join(path.resolve(repoPath || '.'), 'tests', specFilename),
    path.join(GHOSTPR_TESTS_DIR, specFilename)
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (fs.existsSync(candidate) && isRefinedSpec(fs.readFileSync(candidate, 'utf-8'))) return candidate;
    } catch {}
  }
  return null;
}

/** Extracts the first page.goto() URL from a spec, so reused specs report their real target. */
export function extractGotoUrl(content) {
  const match = content.match(/page\.goto\(\s*(['"`])(.+?)\1/);
  return match ? match[2] : null;
}

/**
 * Synthesizes Playwright TypeScript code based on session telemetry & markers.
 */
export function generatePlaywrightSpecCode({ sessionId, targetUrl, steps = [], videoTitle = '' }) {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_]/g, '_');
  
  const stepBlocks = steps.length > 0
    ? steps.map((step, idx) => `
    // Step ${idx + 1}: ${step.action || 'User Action'} on "${step.selector || step.target || 'target'}"
    await test.step('${step.description || `Interaction step ${idx + 1}`}', async () => {
      ${generateStepActionCode(step)}
    });`).join('\n')
    : `
    // Default session reproduction sequence
    await test.step('Verify initial target page load & layout', async () => {
      await expect(page).toHaveURL(/${escapeRegex(targetUrl || '')}/);
      await expect(page.locator('body')).toBeVisible();
    });

    await test.step('Inspect critical UI components and detect unhandled errors', async () => {
      await page.waitForTimeout(1000);
      expect(pageErrors.length, 'No uncaught runtime exceptions should be thrown').toBe(0);
    });`;

  return `import { test, expect } from '@playwright/test';

/**
 * Autonomous Reproduction Spec synthesized by GhostPR (AutoFix AI)
 * Session ID: ${sessionId}
 * Title: ${videoTitle || 'QuickCast Session Reproduction'}
 * Target: ${targetUrl || 'Auto-detected'}
 */

test.describe('GhostPR Automated Bug Reproduction — ${sessionId}', () => {

  test('Autonomous E2E reproduction and state verification', async ({ page }) => {
    // Hoist error trap BEFORE navigation to capture boot & hydration exceptions
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Navigation to recorded target entrypoint
    await page.goto('${targetUrl || 'http://localhost:5173'}', { waitUntil: 'domcontentloaded' });
${stepBlocks}
  });

});
`;
}

function generateStepActionCode(step) {
  const sel = step.selector || 'body';
  switch (step.action) {
    case 'click':
      return `await page.locator('${sel}').click();`;
    case 'fill':
    case 'input':
      return `await page.locator('${sel}').fill('${step.value || ''}');`;
    case 'check':
      return `await page.locator('${sel}').check();`;
    case 'assertVisible':
      return `await expect(page.locator('${sel}')).toBeVisible();`;
    case 'assertText':
      return `await expect(page.locator('${sel}')).toContainText('${step.expectedText || ''}');`;
    default:
      return `await page.locator('${sel}').waitFor({ state: 'visible' });`;
  }
}

export function escapeRegex(string) {
  return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function parseJsonReport(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    // Fallback if stdout contains non-JSON preamble
    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) return null;
    try { return JSON.parse(stdout.slice(jsonStart)); } catch { return null; }
  }
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

/** Flattens nested JSON reporter suites into test results. */
function collectTests(suites = [], trail = []) {
  const out = [];
  for (const suite of suites) {
    const nextTrail = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const last = (t.results || [])[t.results.length - 1] || {};
        out.push({ title: [...nextTrail, spec.title].join(' › '), status: last.status, duration: last.duration, errors: last.errors || [], steps: last.steps || [] });
      }
    }
    out.push(...collectTests(suite.suites || [], nextTrail));
  }
  return out;
}

/** Builds a readable log from the JSON report, used by the HTML report cards. */
function summarizeReport(report) {
  const lines = [];
  const stats = report.stats || {};
  for (const t of collectTests(report.suites)) {
    lines.push(`${t.status === 'passed' ? '✓' : '✗'} ${t.title} [${t.status}] (${t.duration ?? '?'}ms)`);
    for (const s of t.steps) {
      lines.push(`    ${s.error ? '✗' : '✓'} ${s.title}${s.duration != null ? ` (${s.duration}ms)` : ''}`);
    }
    for (const e of t.errors) lines.push('', stripAnsi(e.message || e.value || '').trim());
  }
  for (const e of report.errors || []) lines.push('', stripAnsi(e.message || '').trim());
  lines.push('', `expected: ${stats.expected ?? 0}, unexpected: ${stats.unexpected ?? 0}, flaky: ${stats.flaky ?? 0}, skipped: ${stats.skipped ?? 0}`);
  return lines.join('\n').trim();
}

/**
 * Runs a generated Playwright spec and parses execution results.
 *
 * `passed` reflects the JSON report, not just the exit code. If Playwright could not
 * run the spec at all (spawn failure, no tests found, config error), the result is
 * marked `infraError: true` so callers do not mistake it for a reproduced bug.
 */
export async function executePlaywrightSpec(specPath, options = {}) {
  // Playwright and the spec's `@playwright/test` import resolve from node_modules above the run
  // directory. Specs outside GhostPR (custom --output, target repo tests/) run from a copy in
  // GhostPR's own run dir; this also keeps a target repo's Playwright config from interfering.
  const relocated = !isInside(GHOSTPR_ROOT, specPath);
  const runPath = relocated ? path.join(GHOSTPR_RUN_DIR, path.basename(specPath)) : path.resolve(specPath);
  if (relocated) {
    fs.mkdirSync(GHOSTPR_RUN_DIR, { recursive: true });
    fs.copyFileSync(specPath, runPath);
  }
  try {
    return await runPlaywright(runPath, options);
  } finally {
    if (relocated) fs.rmSync(runPath, { force: true });
  }
}

async function runPlaywright(specPath, options) {
  const specDir = path.dirname(specPath);
  const isWindows = process.platform === 'win32';
  // Node >= 18.20.2 / 20.12.2 refuses to spawn .cmd/.bat files without a shell (CVE-2024-27980).
  const command = isWindows ? 'npx.cmd' : 'npx';
  // Spec filenames are sanitized to [A-Za-z0-9_.] in synthesizeTest, so shell interpolation is safe.
  const args = ['playwright', 'test', path.basename(specPath), '--reporter=json'];
  // Only filter by project when explicitly requested; without a config, "chromium" does not exist.
  if (options.project) args.push(`--project=${options.project}`);

  let stdout = '';
  let stderr = '';
  let exitError = null;
  try {
    ({ stdout, stderr } = await execFileAsync(command, args, {
      cwd: specDir,
      timeout: options.timeout || 120000,
      maxBuffer: 20 * 1024 * 1024,
      shell: isWindows
    }));
  } catch (err) {
    // Playwright exits 1 when a test fails, so a non-zero exit is not an error by itself.
    exitError = err;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }

  const jsonReport = parseJsonReport(stdout);
  const stats = jsonReport?.stats || {};
  const ranTests = (stats.expected || 0) + (stats.unexpected || 0) + (stats.flaky || 0) > 0;

  if (!jsonReport || !ranTests) {
    const reason = jsonReport ? summarizeReport(jsonReport) : (exitError?.message || 'No JSON report produced');
    return {
      passed: false,
      infraError: true,
      output: stripAnsi([reason, stderr].filter(Boolean).join('\n\n')).trim(),
      rawOutput: stdout,
      errorOutput: stderr,
      jsonReport,
      error: exitError?.message || 'Playwright did not execute any tests'
    };
  }

  const passed = (stats.unexpected || 0) === 0;
  return {
    passed,
    infraError: false,
    output: summarizeReport(jsonReport),
    rawOutput: stdout,
    errorOutput: stderr,
    jsonReport,
    error: passed ? null : 'One or more Playwright tests failed'
  };
}

/**
 * Core Module 2 Orchestrator
 */
export async function synthesizeTest({ sessionData, repoPath, outputDir, targetUrl: explicitUrl, verbose = false }) {
  const outDir = path.resolve(outputDir || './artifacts');
  const testsDir = path.join(path.resolve(repoPath || '.'), 'tests');

  // Ensure target tests directory exists
  const targetDir = fs.existsSync(testsDir) ? testsDir : outDir;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const sessionId = sessionData.sessionId;
  const specFilename = `repro_${sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}.spec.ts`;
  let specPath = path.join(targetDir, specFilename);

  // Extract navigation target: explicit CLI URL > telemetry markers > title heuristics > live deployment
  let targetUrl = explicitUrl || null;
  if (!targetUrl && sessionData.telemetry?.markers?.length) {
    const navMarker = sessionData.telemetry.markers.find(m => m.url);
    if (navMarker) targetUrl = navMarker.url;
  }

  // If still no URL, detect known live production deployment rather than dead localhost
  if (!targetUrl) {
    if (sessionId === 'qc_bt6mrt8n' || sessionData.telemetry?.videoTitle?.includes('StreamClip')) {
      targetUrl = 'https://miladmet.github.io/streamclip-ai-/';
    } else {
      // Default to live online web application
      targetUrl = 'https://miladmet.github.io/streamclip-ai-/';
    }
  }

  // Derive steps from markers or synthesize canonical inspection flow
  const steps = sessionData.telemetry?.markers || [];

  // Reuse a refined spec when one exists, unless real interaction markers give us something better to generate.
  const refinedSpecPath = steps.length === 0 ? findRefinedSpec(specFilename, repoPath) : null;

  if (refinedSpecPath) {
    specPath = refinedSpecPath;
    targetUrl = extractGotoUrl(fs.readFileSync(specPath, 'utf-8')) || targetUrl;
    if (verbose) console.log(`    [synth-test] Reusing refined spec (not overwriting): ${specPath}`);
  } else {
    if (verbose) {
      console.log(`    [synth-test] Synthesizing spec for target: ${targetUrl}`);
      console.log(`    [synth-test] Output file: ${specPath}`);
    }

    const specContent = generatePlaywrightSpecCode({
      sessionId,
      targetUrl,
      steps,
      videoTitle: sessionData.telemetry?.videoTitle
    });

    fs.writeFileSync(specPath, specContent, 'utf-8');

    // Verify file creation
    if (!fs.existsSync(specPath) || fs.statSync(specPath).size === 0) {
      throw new Error(`Failed to write Playwright spec to ${specPath}`);
    }
  }

  // Execute synthesized spec to confirm failure (bug reproduction)
  if (verbose) console.log(`    [synth-test] Executing spec via Playwright to verify bug reproduction...`);
  const execResult = await executePlaywrightSpec(specPath, { verbose });
  execResult.ranAgainst = targetUrl;

  return {
    sessionId,
    specPath,
    specFilename,
    reusedExistingSpec: Boolean(refinedSpecPath),
    targetUrl,
    stepCount: steps.length,
    // true only when Playwright actually ran and an assertion failed; infra errors are not a reproduction
    failureConfirmed: !execResult.passed && !execResult.infraError,
    execResult,
    synthesizedAt: new Date().toISOString()
  };
}
