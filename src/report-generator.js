/**
 * GhostPR (AutoFix AI) — Module 5: Visual HTML Reproduction Report (REQ-7)
 *
 * Renders pipeline results into a single, 100% self-contained HTML file:
 *   - embedded dark-mode CSS and vanilla JS (no CDN, no network requests)
 *   - keyframes inlined as base64 data URIs (local files only, zero cloud compute)
 *   - Red (failing) vs Green (passing) Playwright proof cards
 *   - colorized unified diff viewer
 *
 * All dynamic values are HTML-escaped. Playwright output can contain text from
 * the page under test, so it is treated as untrusted. A strict CSP meta tag
 * blocks any network access from the finished report.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_CHARS = 8000;

/** Escapes untrusted text for safe insertion into HTML text/attribute context. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Removes ANSI colour escape sequences emitted by Playwright reporters. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

/** Renders a link only for http(s) URLs; anything else (e.g. javascript:) becomes plain text. */
function safeLink(url) {
  const text = escapeHtml(url);
  return /^https?:\/\//i.test(String(url)) ? `<a href="${text}" rel="noopener noreferrer">${text}</a>` : text;
}

function truncate(text, max = MAX_LOG_CHARS) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/** Derives a "mm:ss" label from names like frame_05s.png. Falls back to the file name. */
export function keyframeLabel(framePath) {
  const base = path.basename(String(framePath));
  const match = base.match(/(\d+)s\.[a-z]+$/i);
  if (!match) return base;
  const total = Number(match[1]);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function toDataUri(filePath) {
  try {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Classifies each line of a unified diff.
 * Handles standard `git diff` output as well as the "+ line" style produced by
 * code-fixer's simplified diff generator.
 */
export function classifyDiffLines(diffText) {
  const lines = String(diffText ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map(text => {
    let kind = 'ctx';
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ')) kind = 'meta';
    else if (text.startsWith('@@')) kind = 'hunk';
    else if (text.startsWith('+')) kind = 'add';
    else if (text.startsWith('-')) kind = 'del';
    return { kind, text };
  });
}

function renderDiff(diffText) {
  const classified = classifyDiffLines(diffText);
  if (!classified.length) {
    return '<p class="muted">No diff was produced for this run.</p>';
  }
  const adds = classified.filter(l => l.kind === 'add').length;
  const dels = classified.filter(l => l.kind === 'del').length;
  const rows = classified
    .map((l, i) => `<div class="dl ${l.kind}"><span class="ln">${i + 1}</span><span class="tx">${escapeHtml(l.text) || '&nbsp;'}</span></div>`)
    .join('');
  return `
    <div class="diff-bar">
      <span class="stat add">+${adds}</span><span class="stat del">-${dels}</span>
      <span class="spacer"></span>
      <button type="button" data-filter="all" class="chip active">All lines</button>
      <button type="button" data-filter="changes" class="chip">Changes only</button>
      <button type="button" id="copy-diff" class="chip">Copy diff</button>
    </div>
    <div class="diff" id="diff" role="region" aria-label="Unified diff of the applied patch">${rows}</div>
    <textarea id="diff-raw" hidden>${escapeHtml(diffText)}</textarea>`;
}

function renderLog(text, emptyMessage) {
  const clean = truncate(stripAnsi(text).trim());
  return clean ? `<pre class="log">${escapeHtml(clean)}</pre>` : `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
}

function badge(label, tone) {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

/**
 * Builds the report HTML string (pure function, no file system writes except
 * reading keyframe images).
 */
export function renderReportHtml(pipelineData = {}, options = {}) {
  const {
    sessionId = 'unknown',
    targetUrl = null,
    telemetry = {},
    keyframes = [],
    patchDiff = '',
    patchSource = null,
    targetFile = null,
    targetLine = null,
    redResult = null,
    greenResult = null,
    bugReproduced = null,
    testPassedAfter = null,
    prUrl = null
  } = pipelineData;

  const generatedAt = options.generatedAt || new Date().toISOString();
  const dryRun = Boolean(options.dryRun);
  const embedImages = options.embedImages !== false;

  // ---- Status badges -------------------------------------------------------
  const badges = [
    redResult?.infraError ? badge('Red: Playwright run error', 'amber')
      : bugReproduced === true ? badge('Red: bug reproduced', 'red')
      : bugReproduced === false ? badge('Red: not reproduced', 'amber')
        : badge('Red: unknown', 'grey'),
    testPassedAfter === true ? badge('Green: patch verified', 'green')
      : testPassedAfter === false ? badge('Green: still failing', 'red')
        : badge('Green: unknown', 'grey'),
    dryRun ? badge('Dry run: no remote push', 'blue') : badge(prUrl ? 'PR opened' : 'PR pending', prUrl ? 'green' : 'amber')
  ].join('');

  // ---- Keyframes -----------------------------------------------------------
  const frameCards = keyframes.length
    ? keyframes.map(fp => {
        const label = keyframeLabel(fp);
        const uri = embedImages ? toDataUri(fp) : null;
        const media = uri
          ? `<img src="${uri}" alt="Keyframe at ${escapeHtml(label)}" loading="lazy" />`
          : '<div class="missing">Image unavailable</div>';
        return `<figure class="frame">${media}<figcaption><span class="ts">${escapeHtml(label)}</span><span class="fn">${escapeHtml(path.basename(String(fp)))}</span></figcaption></figure>`;
      }).join('')
    : '<p class="muted">No keyframes were extracted for this session.</p>';

  // ---- Red / Green proof ---------------------------------------------------
  const logOf = r => r?.output || [r?.errorOutput, r?.error].filter(Boolean).join('\n\n');
  const ranAgainst = r => (r?.ranAgainst ? `<p class="muted">Ran against: ${escapeHtml(r.ranAgainst)}</p>` : '');
  const infraNote = '<p class="muted"><strong>Playwright could not run the spec</strong>, so this is not test evidence:</p>';

  let redBody;
  if (!redResult) {
    redBody = '<p class="muted">No Playwright result was captured for the initial run.</p>';
  } else if (redResult.infraError) {
    redBody = infraNote + renderLog(logOf(redResult), 'No output captured.');
  } else if (redResult.passed) {
    redBody = '<p class="muted">The reproduction spec <strong>passed</strong> on the unpatched target, so this spec did not reproduce the bug.</p>' + renderLog(logOf(redResult), '');
  } else {
    redBody = renderLog(logOf(redResult), 'The spec failed but no output was captured.');
  }

  let greenBody;
  if (greenResult) {
    greenBody = greenResult.infraError
      ? infraNote + renderLog(logOf(greenResult), 'No output captured.')
      : renderLog(logOf(greenResult), greenResult.passed ? 'All steps passed.' : 'The post-patch run failed with no output captured.');
  } else if (testPassedAfter === true) {
    greenBody = '<p class="muted">The fixer reported a passing verification, but no Playwright output was captured for the post-patch run.</p>';
  } else {
    greenBody = '<p class="muted">No post-patch verification result is available.</p>';
  }

  const title = `GhostPR Report — ${sessionId}`;
  const watchUrl = telemetry?.watchUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0b0f;--panel:#14141c;--border:#282836;--text:#f5f5f7;--muted:#9494a6;--purple:#9147ff;--green:#10b981;--red:#ef4444;--amber:#f59e0b;--blue:#38bdf8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--blue)}
header,main{max-width:1100px;margin:0 auto;padding:0 20px}
header{padding-top:28px}
h1{margin:0 0 4px;font-size:24px}
h2{margin:0 0 12px;font-size:17px}
.sub{color:var(--muted);margin:0 0 14px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:14px 0}
.meta div{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px;overflow-wrap:anywhere}
.meta dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.meta dd{margin:2px 0 0}
.badges{display:flex;flex-wrap:wrap;gap:8px}
.badge{padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid}
.badge.red{color:#fca5a5;background:#ef444422;border-color:#ef444477}
.badge.green{color:#6ee7b7;background:#10b98122;border-color:#10b98177}
.badge.amber{color:#fcd34d;background:#f59e0b22;border-color:#f59e0b77}
.badge.blue{color:#7dd3fc;background:#38bdf822;border-color:#38bdf877}
.badge.grey{color:var(--muted);background:#ffffff0f;border-color:var(--border)}
section{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px;margin:18px 0}
.frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.frame{margin:0;background:#0f0f15;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.frame img{display:block;width:100%;height:auto;cursor:zoom-in}
.frame figcaption{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;font-size:12px}
.ts{color:var(--purple);font-weight:700;font-variant-numeric:tabular-nums}
.fn{color:var(--muted)}
.missing{padding:40px 10px;text-align:center;color:var(--muted)}
.proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}
.card{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#0f0f15}
.card>summary{list-style:none;cursor:pointer;padding:10px 14px;font-weight:700;display:flex;align-items:center;gap:8px}
.card>summary::-webkit-details-marker{display:none}
.card.red{border-color:#ef444466}.card.red>summary{background:#ef444418;color:#fca5a5}
.card.green{border-color:#10b98166}.card.green>summary{background:#10b98118;color:#6ee7b7}
.card .body{padding:12px 14px}
.log{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:340px;overflow:auto}
.muted{color:var(--muted);margin:0}
.diff-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.spacer{flex:1}
.stat{font:700 13px ui-monospace,Consolas,monospace;padding:2px 8px;border-radius:6px}
.stat.add{color:#6ee7b7;background:#10b98120}.stat.del{color:#fca5a5;background:#ef444420}
.chip{background:#20202c;color:var(--text);border:1px solid #3f3f52;border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}
.chip:hover{border-color:var(--purple)}.chip.active{border-color:var(--purple);background:#9147ff33}
.diff{border:1px solid var(--border);border-radius:10px;overflow:auto;max-height:480px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;background:#0a0a0f}
.dl{display:flex;white-space:pre}
.dl .ln{flex:none;width:44px;text-align:right;padding-right:10px;color:#5b5b70;user-select:none}
.dl .tx{flex:1;padding-right:12px}
.dl.add{background:#10b9811f;color:#a7f3d0}
.dl.del{background:#ef44441f;color:#fecaca}
.dl.hunk{background:#9147ff22;color:#d8b4fe}
.dl.meta{color:var(--muted)}
.diff.changes .dl.ctx,.diff.changes .dl.meta{display:none}
footer{max-width:1100px;margin:0 auto;padding:6px 20px 40px;color:var(--muted);font-size:12px}
@media (max-width:520px){.proof{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>👻 GhostPR Reproduction Report</h1>
  <p class="sub">Autonomous bug-to-PR pipeline · QuickCast → Playwright → Git</p>
  <div class="badges">${badges}</div>
  <dl class="meta">
    <div><dt>QuickCast session</dt><dd>${escapeHtml(sessionId)}</dd></div>
    <div><dt>Target URL</dt><dd>${targetUrl ? safeLink(targetUrl) : 'Not resolved'}</dd></div>
    <div><dt>Recording</dt><dd>${escapeHtml(telemetry?.videoTitle || 'QuickCast Session')}${watchUrl ? ` · ${safeLink(watchUrl)}` : ''}</dd></div>
    <div><dt>Generated</dt><dd><time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></dd></div>
    <div><dt>Fault location</dt><dd>${targetFile ? escapeHtml(`${targetFile}${targetLine ? `:${targetLine}` : ''}`) : 'Not located'}</dd></div>
    <div><dt>Pull request</dt><dd>${prUrl ? safeLink(prUrl) : (dryRun ? 'Skipped (dry run)' : 'Not opened')}</dd></div>
  </dl>
</header>
<main>
  <section aria-labelledby="h-frames">
    <h2 id="h-frames">🎞️ Video Telemetry · Keyframes</h2>
    <div class="frames">${frameCards}</div>
  </section>

  <section aria-labelledby="h-proof">
    <h2 id="h-proof">🔴➡️🟢 Red-to-Green Proof</h2>
    <div class="proof">
      <details class="card red" open>
        <summary>🔴 Red · initial Playwright run (unpatched)</summary>
        <div class="body">${ranAgainst(redResult)}${redBody}</div>
      </details>
      <details class="card green" open>
        <summary>🟢 Green · post-patch verification</summary>
        <div class="body">${ranAgainst(greenResult)}${greenBody}</div>
      </details>
    </div>
  </section>

  <section aria-labelledby="h-diff">
    <h2 id="h-diff">🩹 Applied Defensive Patch</h2>
    ${patchSource ? `<p class="muted" style="margin-bottom:10px">Source: ${escapeHtml(patchSource)}</p>` : ''}
    ${renderDiff(patchDiff)}
  </section>
</main>
<footer>Generated by GhostPR (AutoFix AI) · self-contained report, no external requests.</footer>
<script>
(function () {
  var diff = document.getElementById('diff');
  var chips = document.querySelectorAll('[data-filter]');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      if (diff) diff.classList.toggle('changes', chip.getAttribute('data-filter') === 'changes');
    });
  });
  var copy = document.getElementById('copy-diff');
  var raw = document.getElementById('diff-raw');
  if (copy && raw) {
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy diff'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw.value).then(done, function () { raw.hidden = false; raw.select(); });
      } else { raw.hidden = false; raw.select(); }
    });
  }
})();
</script>
</body>
</html>
`;
}

/**
 * Generates `<outputDir>/report.html` from pipeline results.
 *
 * @param {object} pipelineData  sessionId, targetUrl, telemetry, keyframes, patchDiff,
 *                               targetFile, targetLine, redResult, greenResult,
 *                               bugReproduced, testPassedAfter, prUrl
 * @param {object} [options]     outputDir (default ./artifacts), dryRun, embedImages, generatedAt
 * @returns {{ reportPath: string, sizeBytes: number }}
 */
export function generateHtmlReport(pipelineData, options = {}) {
  const outputDir = path.resolve(options.outputDir || './artifacts');
  fs.mkdirSync(outputDir, { recursive: true });

  const html = renderReportHtml(pipelineData, options);
  const reportPath = path.join(outputDir, 'report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');

  const sizeBytes = fs.statSync(reportPath).size;
  if (sizeBytes === 0) throw new Error(`Failed to write HTML report to ${reportPath}`);
  return { reportPath, sizeBytes };
}
