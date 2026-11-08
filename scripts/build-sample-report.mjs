#!/usr/bin/env node
/**
 * Builds the public sample report for the README from the last real pipeline run.
 *
 *   node src/cli.js --session qc_bt6mrt8n --repo ../streamclip-ai- --dry-run
 *   node scripts/build-sample-report.mjs
 *
 * Privacy:
 *   - keyframes are cropped to the web app viewport, removing the OS taskbar, browser tabs,
 *     address bar, bookmarks bar and screen-sharing infobar
 *   - local paths are redacted ([workspace], [target-repo], ~)
 * Outputs: docs/sample-report.html, docs/report-screenshot.png
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { generateHtmlReport } from '../src/report-generator.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE_PATH = path.join(ROOT, 'artifacts', 'pipeline-state.json');
const DOCS_DIR = path.join(ROOT, 'docs');

// App viewport inside the 1366x768 qc_bt6mrt8n screen recording (measured from the keyframes).
// Override with GHOSTPR_CROP="x,y,width,height" for recordings with a different layout.
const CROP = (() => {
  const env = process.env.GHOSTPR_CROP?.split(',').map(Number);
  if (env?.length === 4 && env.every(Number.isFinite)) return { x: env[0], y: env[1], width: env[2], height: env[3] };
  return { x: 4, y: 160, width: 1342, height: 554 };
})();

if (!fs.existsSync(STATE_PATH)) {
  console.error(`Missing ${path.relative(ROOT, STATE_PATH)}. Run the pipeline first (see header).`);
  process.exit(1);
}
const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostpr-sample-'));
const browser = await chromium.launch();
try {
  // 1. Crop keyframes: show each image at natural size and screenshot only the app region
  const cropped = [];
  const page = await browser.newPage();
  for (const frame of state.keyframes || []) {
    if (!fs.existsSync(frame)) continue;
    const dataUri = `data:image/png;base64,${fs.readFileSync(frame).toString('base64')}`;
    await page.setContent(`<body style="margin:0"><img id="f" src="${dataUri}" style="display:block"></body>`);
    const { w, h } = await page.locator('#f').evaluate(img => ({ w: img.naturalWidth, h: img.naturalHeight }));
    if (CROP.x + CROP.width > w || CROP.y + CROP.height > h) throw new Error(`Crop box exceeds ${path.basename(frame)} (${w}x${h})`);
    await page.setViewportSize({ width: w, height: h });
    const out = path.join(tmp, path.basename(frame));
    await page.screenshot({ path: out, clip: CROP });
    cropped.push(out);
  }
  await page.close();

  // 2. Render the sanitized report into docs/
  const { reportPath, sizeBytes } = generateHtmlReport({ ...state, keyframes: cropped }, {
    outputDir: DOCS_DIR,
    fileName: 'sample-report.html',
    dryRun: state.dryRun,
    generatedAt: state.savedAt,
    redactPaths: [
      { path: state.roots?.workspace, label: '[workspace]' },
      { path: state.roots?.targetRepo, label: '[target-repo]' },
      { path: tmp, label: '[keyframes]' }
    ]
  });
  console.log(`✓ ${path.relative(ROOT, reportPath)} (${(sizeBytes / 1024).toFixed(0)} KB, ${cropped.length} cropped keyframes)`);

  // 3. Full-page screenshot of the report for the README
  const shot = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'dark' });
  await shot.goto(pathToFileURL(reportPath).href);
  const shotPath = path.join(DOCS_DIR, 'report-screenshot.png');
  await shot.screenshot({ path: shotPath, fullPage: true });
  console.log(`✓ ${path.relative(ROOT, shotPath)} (${(fs.statSync(shotPath).size / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
