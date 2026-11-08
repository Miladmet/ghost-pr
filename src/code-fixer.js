/**
 * GhostPR (AutoFix AI) — Module 3: Codebase Diagnoser & Self-Healing Patch Engine
 * 
 * Takes failure diagnostics from Module 2 (failing assertions, stack traces, DOM selectors),
 * scans the target repository to locate the faulty file and lines,
 * generates a verified Git diff patch, and runs a self-healing verification loop.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import http from 'node:http';
import { executePlaywrightSpec, escapeRegex } from './synth-test.js';

const execFileAsync = promisify(execFile);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webm': 'video/webm', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'
};

/**
 * Serves `rootDir` as static files on 127.0.0.1 with an OS-assigned port.
 * Rejects path traversal and dotfiles (e.g. .git, .env) so nothing sensitive is exposed.
 */
export function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.split('/').some(seg => seg.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    let filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise(done => {
          server.closeAllConnections?.();
          server.close(() => done());
        })
      });
    });
  });
}

/**
 * Rewrites a spec's production URL references to the local server: page.goto() literals,
 * regex-escaped URL assertions, and host-only regex assertions. Returns the replacement count.
 */
export function retargetSpec(content, fromUrl, toUrl) {
  const hostOf = u => u.replace(/^https?:\/\//i, '');
  const pairs = [
    [fromUrl, toUrl],
    [escapeRegex(fromUrl), escapeRegex(toUrl)],
    [escapeRegex(hostOf(fromUrl)), escapeRegex(hostOf(toUrl))]
  ];
  let replacements = 0;
  let out = content;
  for (const [from, to] of pairs) {
    if (!from) continue;
    const parts = out.split(from);
    replacements += parts.length - 1;
    out = parts.join(to);
  }
  return { content: out, replacements };
}

/**
 * Runs the reproduction spec against a local static server of the (patched) target repo.
 * The committed spec is never modified: a retargeted copy is written to `workDir` and removed afterwards.
 */
export async function verifyAgainstLocalBuild({ repoPath, specPath, productionUrl, workDir, verbose = false }) {
  const root = path.resolve(repoPath);
  const fail = (reason) => ({ passed: false, infraError: true, output: reason, error: reason, ranAgainst: null });

  if (!fs.existsSync(path.join(root, 'index.html'))) {
    return fail(`No index.html at ${root}; cannot serve a local build for verification.`);
  }
  if (!productionUrl) return fail('Spec target URL unknown; cannot retarget the spec to the local build.');

  const server = await startStaticServer(root);
  const verifyPath = path.join(path.resolve(workDir), `verify_${path.basename(specPath)}`);
  try {
    const { content, replacements } = retargetSpec(fs.readFileSync(specPath, 'utf-8'), productionUrl, server.url);
    if (replacements === 0) return fail(`Spec does not reference ${productionUrl}; cannot retarget it to ${server.url}.`);

    fs.mkdirSync(path.dirname(verifyPath), { recursive: true });
    fs.writeFileSync(verifyPath, content, 'utf-8');
    if (verbose) console.log(`    [code-fixer] Serving patched build at ${server.url} (${replacements} URL references retargeted)`);

    const result = await executePlaywrightSpec(verifyPath);
    result.ranAgainst = `${server.url} (local build of ${root})`;
    return result;
  } finally {
    try { fs.rmSync(verifyPath, { force: true }); } catch {}
    await server.close();
    if (verbose) console.log(`    [code-fixer] Local verification server stopped`);
  }
}

/**
 * Captures the real diff of the target repo against its upstream branch, so the patch
 * includes fix commits not yet pushed as well as uncommitted edits. Falls back to `git diff HEAD`.
 */
export async function captureRepoDiff(repoPath) {
  const root = path.resolve(repoPath);
  const git = args => execFileAsync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { diff: '', source: null };
  }
  try {
    const { stdout: upstream } = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const { stdout } = await git(['diff', '@{u}']);
    if (stdout.trim()) return { diff: stdout, source: `git diff ${upstream.trim()} (unpushed commits + working tree)` };
  } catch {}
  // Local fix branches (e.g. fix/ghost-pr-<id>) have no upstream: diff from where they forked off the remote default branch
  for (const baseRef of ['origin/HEAD', 'origin/main', 'origin/master']) {
    try {
      const { stdout: base } = await git(['merge-base', 'HEAD', baseRef]);
      const { stdout: branch } = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const { stdout } = await git(['diff', base.trim()]);
      if (stdout.trim()) return { diff: stdout, source: `git diff ${baseRef}...${branch.trim()} (branch commits + working tree)` };
      break;
    } catch {}
  }
  try {
    const { stdout } = await git(['diff', 'HEAD']);
    if (stdout.trim()) return { diff: stdout, source: 'git diff HEAD (working tree)' };
  } catch {}
  return { diff: '', source: null };
}

/** First changed file and new-side start line in a unified diff. */
function firstChangeInDiff(diff) {
  const file = diff.match(/^\+\+\+ b\/(.+)$/m)?.[1] || null;
  const line = Number(diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m)?.[1]) || null;
  return { file, line };
}

/**
 * Searches the target repository for files referencing the target selector,
 * error string, or function name.
 */
export async function locateFaultySourceFile(repoPath, searchTerms = []) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root)) throw new Error(`Target repository not found at: ${root}`);

  const candidates = [];
  const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'artifacts', 'test-results', 'coverage']);

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.ts', '.jsx', '.tsx', '.vue', '.html', '.svelte'].includes(ext)) {
          candidates.push(path.join(dir, entry.name));
        }
      }
    }
  }

  walk(root);

  // Score candidate files by matching search terms
  const matches = [];
  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let score = 0;
      const matchedLines = [];

      for (const term of searchTerms) {
        if (!term || term.length < 3) continue;
        const cleanTerm = term.replace(/[#.]/g, '');
        if (content.includes(cleanTerm)) {
          score += 10;
          // Find matching line numbers
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.includes(cleanTerm)) matchedLines.push(idx + 1);
          });
        }
      }

      if (score > 0) {
        matches.push({
          filePath,
          relativePath: path.relative(root, filePath),
          score,
          matchedLines: [...new Set(matchedLines)]
        });
      }
    } catch {}
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0] || null;
}

/**
 * Generates an automated bug fix based on the failure pattern.
 * e.g., missing null checks, event unbinding, unhandled async states, or selector fixes.
 */
export function generatePatch({ filePath, originalContent, issueType = 'null_check', searchToken }) {
  let patchedContent = originalContent;
  let explanation = '';

  switch (issueType) {
    case 'null_check':
    default:
      // Canonical defensive check injection
      if (searchToken && originalContent.includes(searchToken)) {
        explanation = `Added defensive optional chaining/null check around \`${searchToken}\`.`;
        // Replace unshielded access if applicable
        const pattern = new RegExp(`(?<!\\?\\.)\\b${searchToken}\\.([a-zA-Z0-9_]+)`, 'g');
        if (pattern.test(originalContent)) {
          patchedContent = originalContent.replace(pattern, `${searchToken}?.$1`);
        }
      }
      break;
  }

  return {
    patchedContent,
    modified: patchedContent !== originalContent,
    explanation
  };
}

/**
 * Creates a standard unified git diff string between original and patched content.
 */
export function createUnifiedDiff(relativePath, originalContent, patchedContent) {
  const origLines = originalContent.split('\n');
  const patchLines = patchedContent.split('\n');

  const diffHeader = [
    `--- a/${relativePath.replace(/\\/g, '/')}`,
    `+++ b/${relativePath.replace(/\\/g, '/')}`,
    `@@ -1,${origLines.length} +1,${patchLines.length} @@`
  ];

  // Simplified diff representation for demonstration and PR application
  const diffBody = patchLines.map(line => `+ ${line}`);
  return [...diffHeader, ...diffBody].join('\n');
}

/**
 * Core Module 3 Orchestrator:
 * Diagnoses failure -> generates patch -> applies to disk -> verifies with Playwright.
 */
export async function fixCodebase({ repoPath, testFailure, specPath, outputDir, verbose = false }) {
  const root = path.resolve(repoPath || '.');
  
  // Extract search terms from test failure
  const searchTerms = [
    testFailure.selector,
    testFailure.targetUrl,
    testFailure.error
  ].filter(Boolean);

  if (verbose) {
    console.log(`    [code-fixer] Scanning repository: ${root}`);
    console.log(`    [code-fixer] Search terms: ${JSON.stringify(searchTerms)}`);
  }

  // 1. Locate source file
  const faultLocation = await locateFaultySourceFile(root, searchTerms);
  
  let targetFile = faultLocation ? faultLocation.relativePath : null;
  let targetLine = faultLocation?.matchedLines?.[0] || null;

  if (verbose && faultLocation) {
    console.log(`    [code-fixer] Located fault in: ${targetFile} (line ${targetLine})`);
  }

  // 2. Generate patch diff
  let patchDiff = '';
  if (faultLocation && fs.existsSync(faultLocation.filePath)) {
    const original = fs.readFileSync(faultLocation.filePath, 'utf-8');
    const { patchedContent, modified, explanation } = generatePatch({
      filePath: faultLocation.filePath,
      originalContent: original,
      issueType: 'null_check',
      searchToken: searchTerms[0]
    });

    if (modified) {
      patchDiff = createUnifiedDiff(targetFile, original, patchedContent);
      // Apply the patch to disk so it can be verified (and captured by git diff below)
      fs.writeFileSync(faultLocation.filePath, patchedContent, 'utf-8');
    }
  }

  // 3. Prefer the real git diff of the target repo over the simplified generated one
  const { diff: repoDiff, source: patchSource } = await captureRepoDiff(root);
  if (repoDiff) {
    patchDiff = repoDiff;
    if (!targetFile) ({ file: targetFile, line: targetLine } = firstChangeInDiff(repoDiff));
    if (verbose) console.log(`    [code-fixer] Captured real patch from ${patchSource}`);
  } else if (verbose) {
    console.log(`    [code-fixer] No changes found in the target repo; no patch to report`);
  }

  // 4. Self-healing verification: run the spec against a local server of the patched repo
  let verification = null;
  if (specPath && fs.existsSync(specPath)) {
    verification = await verifyAgainstLocalBuild({
      repoPath: root,
      specPath,
      productionUrl: testFailure?.targetUrl,
      workDir: outputDir || path.dirname(specPath),
      verbose
    });
  } else if (verbose) {
    console.log(`    [code-fixer] No spec available to verify the patch`);
  }

  return {
    targetFile,
    targetLine,
    patchDiff,
    patchSource,
    verification,
    // Green only when Playwright actually ran and every test passed
    verifiedPassing: Boolean(verification?.passed),
    fixedAt: new Date().toISOString()
  };
}
