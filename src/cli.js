#!/usr/bin/env node

/**
 * GhostPR (AutoFix AI) — CLI Entrypoint
 * Command-Line Interface contract following best practice Interface-Driven Design.
 * 
 * Usage:
 *   node src/cli.js --session <quickcast_url_or_id> --repo <target_repo_path> [options]
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const HELP_TEXT = `
👻 GhostPR (AutoFix AI) — Autonomous Visual Bug Reproduction to Passing Git PR
Built for Kiroween Hackathon 2026

USAGE:
  node src/cli.js --session <url_or_id> --repo <path> [options]

REQUIRED FLAGS:
  -s, --session <url_or_id>   QuickCast watch URL or session ID (e.g. qc_bt6mrt8n)
  -r, --repo <path>           Path to the target codebase repository

OPTIONS:
  -o, --output <dir>          Output directory for generated tests and reports (default: ./artifacts)
  --dry-run                   Run reproduction and patch generation without opening a GitHub PR
  --verbose                   Enable detailed debug output
  -h, --help                  Show this help menu
  -v, --version               Show GhostPR version

EXAMPLES:
  # Full autonomous pipeline (Ingest -> Reproduce -> Fix -> PR)
  node src/cli.js -s "https://quickcast-r2-uploader.admettre.workers.dev/watch/qc_bt6mrt8n" -r "../my-app"

  # Dry run (Reproduce bug and generate patch locally)
  node src/cli.js -s qc_bt6mrt8n -r "../my-app" --dry-run
`;

export function parseCliArguments(rawArgs = process.argv.slice(2)) {
  const options = {
    session: { type: 'string', short: 's' },
    repo: { type: 'string', short: 'r' },
    output: { type: 'string', short: 'o', default: './artifacts' },
    'dry-run': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  };

  try {
    const { values } = parseArgs({ args: rawArgs, options, allowPositionals: true });
    return values;
  } catch (err) {
    console.error(`❌ Argument error: ${err.message}\n`);
    console.log(HELP_TEXT);
    process.exit(1);
  }
}

export async function runGhostPR(config) {
  console.log(`\n======================================================`);
  console.log(` 👻 GhostPR (AutoFix AI) — Autonomous Bug-to-PR Engine `);
  console.log(`======================================================\n`);

  console.log(`📦 Configuration:`);
  console.log(`  • Session Target:  ${config.session}`);
  console.log(`  • Codebase Repo:   ${path.resolve(config.repo)}`);
  console.log(`  • Output Dir:      ${path.resolve(config.output)}`);
  console.log(`  • Dry-Run Mode:    ${config['dry-run'] ? 'YES (local verification only)' : 'NO (opens real PR)'}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(config.output)) {
    fs.mkdirSync(config.output, { recursive: true });
  }

  // Pipeline State
  const pipelineState = {
    sessionId: null,
    videoPath: null,
    telemetry: null,
    specPath: null,
    testPassedBefore: null,
    patchDiff: null,
    testPassedAfter: null,
    prUrl: null,
  };

  try {
    // -------------------------------------------------------------
    // STAGE 1: Visual & Session Ingestion
    // -------------------------------------------------------------
    console.log(`[Stage 1/4] 📥 Ingesting QuickCast recording & visual telemetry...`);
    const { ingestSession } = await import('./ingest.js');
    const ingestResult = await ingestSession(config.session, {
      outputDir: config.output,
      verbose: config.verbose
    });
    pipelineState.sessionId = ingestResult.sessionId;
    pipelineState.videoPath = ingestResult.videoPath;
    pipelineState.telemetry = ingestResult.telemetry;
    console.log(`  ✓ Session verified: ${pipelineState.sessionId}`);
    console.log(`  ✓ Video stream ready: ${pipelineState.videoPath} (${(ingestResult.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  ✓ Keyframes extracted: ${ingestResult.keyframes.length} frames`);

    // -------------------------------------------------------------
    // STAGE 2: Playwright Reproduction Test Synthesis
    // -------------------------------------------------------------
    console.log(`\n[Stage 2/4] 🧪 Synthesizing automated Playwright reproduction test...`);
    const { synthesizeTest } = await import('./synth-test.js');
    const testResult = await synthesizeTest({
      sessionData: ingestResult,
      repoPath: config.repo,
      outputDir: config.output,
      verbose: config.verbose
    });
    pipelineState.specPath = testResult.specPath;
    console.log(`  ✓ Spec generated: ${pipelineState.specPath}`);
    console.log(`  ✓ Initial test execution confirms bug reproduction: ${testResult.failureConfirmed ? 'BUG REPRODUCED (Failing as expected)' : 'Warning: Test passed initially'}`);

    // -------------------------------------------------------------
    // STAGE 3: Autonomous Code Diagnosis & Patching
    // -------------------------------------------------------------
    console.log(`\n[Stage 3/4] 🔍 Diagnosing codebase & generating self-healing patch...`);
    const { fixCodebase } = await import('./code-fixer.js');
    const fixResult = await fixCodebase({
      repoPath: config.repo,
      testFailure: testResult,
      specPath: pipelineState.specPath,
      verbose: config.verbose
    });
    pipelineState.patchDiff = fixResult.patchDiff;
    pipelineState.testPassedAfter = fixResult.verifiedPassing;
    console.log(`  ✓ Fault located in: ${fixResult.targetFile}:${fixResult.targetLine || 1}`);
    console.log(`  ✓ Patch applied & verified with Playwright: ${fixResult.verifiedPassing ? '✅ PASSING (Green)' : '❌ Still failing'}`);

    // -------------------------------------------------------------
    // STAGE 4: Git Branch & Pull Request Dispatch
    // -------------------------------------------------------------
    console.log(`\n[Stage 4/4] 🚀 Dispatching Git Pull Request...`);
    if (config['dry-run']) {
      console.log(`  ℹ️ Dry-run mode enabled. Skipping remote Git push.`);
      console.log(`  ✓ Local patch saved to: ${path.join(config.output, 'fix.patch')}`);
      fs.writeFileSync(path.join(config.output, 'fix.patch'), fixResult.patchDiff || '# No changes');
    } else {
      const { createPullRequest } = await import('./git-pr.js');
      const prResult = await createPullRequest({
        repoPath: config.repo,
        sessionId: pipelineState.sessionId,
        patchDiff: pipelineState.patchDiff,
        specPath: pipelineState.specPath,
        telemetry: pipelineState.telemetry,
        verbose: config.verbose
      });
      pipelineState.prUrl = prResult.prUrl;
      console.log(`  🎉 Pull Request successfully opened: ${pipelineState.prUrl}`);
    }

    console.log(`\n======================================================`);
    console.log(` ✅ GhostPR Pipeline Complete: 100% Autonomous Resolution `);
    console.log(`======================================================\n`);

    return pipelineState;

  } catch (error) {
    console.error(`\n❌ Pipeline failed at stage execution: ${error.message}`);
    if (config.verbose) console.error(error.stack);
    process.exit(1);
  }
}

// Direct CLI invocation
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const args = parseCliArguments();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    console.log(`GhostPR v${pkg.version}`);
    process.exit(0);
  }

  if (!args.session || !args.repo) {
    console.error(`❌ Error: Both --session (-s) and --repo (-r) flags are required.\n`);
    console.log(HELP_TEXT);
    process.exit(1);
  }

  runGhostPR(args);
}
