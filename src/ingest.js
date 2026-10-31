/**
 * GhostPR (AutoFix AI) — Module 1: Session & Visual Ingestion
 * Ingests QuickCast video stream and visual telemetry without cloud GPU overhead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseSessionId(input) {
  if (!input) throw new Error("No session input provided.");
  const clean = input.trim();
  // Match URL pattern: .../watch/qc_... or .../v/qc_...
  const match = clean.match(/qc_[a-z0-9]+/i);
  if (match) return match[0];
  if (/^qc_[a-z0-9]+$/i.test(clean)) return clean;
  throw new Error(`Invalid QuickCast session identifier: "${input}". Expected format like "qc_bt6mrt8n" or watch URL.`);
}

export async function downloadVideoStream(sessionId, outputDir) {
  const videoUrl = `https://quickcast-r2-uploader.admettre.workers.dev/v/${sessionId}`;
  const videoPath = path.join(outputDir, `${sessionId}.webm`);

  // If already downloaded, reuse
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 1000) {
    return { videoPath, sizeBytes: fs.statSync(videoPath).size };
  }

  // Fetch using standard curl binary (safe & native)
  await execFileAsync('curl.exe', ['-s', '-L', '-o', videoPath, videoUrl]);

  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    throw new Error(`Failed to download video stream from ${videoUrl}`);
  }

  return { videoPath, sizeBytes: fs.statSync(videoPath).size };
}

export async function extractKeyframes(videoPath, outputDir, timestamps = [1, 5, 10, 20]) {
  const keyframesDir = path.join(outputDir, 'keyframes');
  if (!fs.existsSync(keyframesDir)) fs.mkdirSync(keyframesDir, { recursive: true });

  const frames = [];
  // Probe python imageio-ffmpeg executable
  for (const sec of timestamps) {
    const frameName = `frame_${sec.toString().padStart(2, '0')}s.png`;
    const framePath = path.join(keyframesDir, frameName);
    
    try {
      await execFileAsync('python', [
        '-c',
        `import subprocess, imageio_ffmpeg; exe=imageio_ffmpeg.get_ffmpeg_exe(); subprocess.run([exe, '-y', '-ss', '${sec}', '-i', r'${videoPath}', '-vframes', '1', r'${framePath}'], capture_output=True)`
      ]);
      if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
        frames.push(framePath);
      }
    } catch {
      // Continue if video is shorter than this timestamp
    }
  }

  return frames;
}

export async function fetchSessionTelemetry(sessionId) {
  const watchUrl = `https://quickcast-r2-uploader.admettre.workers.dev/watch/${sessionId}`;
  
  try {
    const { stdout } = await execFileAsync('curl.exe', ['-s', '-L', watchUrl]);
    
    // Parse metadata from Watch page HTML
    const titleMatch = stdout.match(/<title>(.*?)<\/title>/i);
    const videoTitle = titleMatch ? titleMatch[1].replace(/— QuickCast$/i, '').trim() : 'QuickCast Session';

    // Parse interaction markers if embedded
    let markers = [];
    const markersMatch = stdout.match(/var sessionMarkers = (\[.*?\]);/s);
    if (markersMatch) {
      try { markers = JSON.parse(markersMatch[1]); } catch {}
    }

    return {
      sessionId,
      watchUrl,
      videoTitle,
      markers,
      ingestedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      sessionId,
      watchUrl,
      videoTitle: 'QuickCast Tab Recording',
      markers: [],
      error: err.message,
      ingestedAt: new Date().toISOString()
    };
  }
}

export async function ingestSession(input, options = {}) {
  const outputDir = path.resolve(options.outputDir || './artifacts');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const sessionId = parseSessionId(input);
  if (options.verbose) console.log(`    [ingest] Identified session ID: ${sessionId}`);

  // 1. Download video
  const { videoPath, sizeBytes } = await downloadVideoStream(sessionId, outputDir);
  if (options.verbose) console.log(`    [ingest] Video downloaded: ${videoPath} (${sizeBytes} bytes)`);

  // 2. Fetch session metadata & markers
  const telemetry = await fetchSessionTelemetry(sessionId);
  if (options.verbose) console.log(`    [ingest] Telemetry loaded: "${telemetry.videoTitle}"`);

  // 3. Extract visual keyframes
  const keyframes = await extractKeyframes(videoPath, outputDir);
  if (options.verbose) console.log(`    [ingest] Extracted ${keyframes.length} visual keyframes`);

  // Save telemetry manifest
  const manifestPath = path.join(outputDir, `${sessionId}_manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({ sessionId, videoPath, sizeBytes, telemetry, keyframes }, null, 2));

  return {
    sessionId,
    videoPath,
    sizeBytes,
    telemetry,
    keyframes,
    manifestPath
  };
}
