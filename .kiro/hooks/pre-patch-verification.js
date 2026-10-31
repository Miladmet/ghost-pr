#!/usr/bin/env node

/**
 * Kiro Agent Hook: pre-patch-verification
 * 
 * Executes the synthesized Playwright reproduction spec before and after
 * Kiro applies a code fix to verify that the patch heals the defect.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

export async function prePatchVerification(specPath) {
  console.log(`[Kiro Hook: pre-patch-verification] Running: ${specPath}`);
  try {
    const { stdout } = await execAsync('npx', ['playwright', 'test', specPath, '--project=chromium']);
    return { status: 'passed', output: stdout };
  } catch (err) {
    return { status: 'failed', output: err.stdout || err.message };
  }
}
