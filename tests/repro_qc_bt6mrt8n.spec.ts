import { test, expect } from '@playwright/test';

/**
 * Reproduction Spec for GhostPR (AutoFix AI)
 * Session ID: qc_bt6mrt8n
 * Title: QuickCast Tab Recording 10/28/2026
 * Target: https://miladmet.github.io/streamclip-ai-/
 *
 * Recorded journey (keyframes @ 5s, 10s, 20s): the user captures a tab, the rolling
 * buffer auto-starts ("Buffer Active (n/30s)"), and "Clip last 30 seconds" is enabled.
 *
 * This spec replays that journey with Chromium's fake media flags so the capture
 * prompt is auto-accepted and a synthetic stream is supplied.
 *
 * Bug (reproduced on production): clicking "Simulate Chat Hype Spike" before any capture
 * shows "Auto-clipping last 30s…" and overwrites the clip attribution, but no clip is made.
 * Expected: a clear warning, attribution untouched, and auto-clip still working once capturing.
 */

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  }
});

test.describe('GhostPR Automated Bug Reproduction — qc_bt6mrt8n', () => {

  test('Hype spike handling before and after capture', async ({ page }) => {
    // Hoist error trap BEFORE navigation to capture boot & hydration exceptions
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto('https://miladmet.github.io/streamclip-ai-/', { waitUntil: 'networkidle' });

    await test.step('Verify initial target page load & layout', async () => {
      await expect(page).toHaveURL(/miladmet\.github\.io\/streamclip\-ai\-\//);
      await expect(page).toHaveTitle(/StreamClip AI/);
    });

    await test.step('Verify idle state before capture', async () => {
      await expect(page.locator('#start')).toHaveText(/Start rolling buffer/);
      await expect(page.locator('#start')).toBeDisabled();
      await expect(page.locator('#clip')).toBeDisabled();
    });

    await test.step('Hype spike before capture must not claim an auto-clip', async () => {
      // Bug: without a capture, recordChatHype() announces "Auto-clipping last 30s…" and
      // overwrites the clip attribution, but exportAt() silently does nothing (no buffer).
      await page.locator('#simHypeBtn').click();
      await expect(page.locator('#hypeScoreText')).toHaveText('(100% Hype)');
      await expect(page.locator('#chatStatus')).toHaveText(
        '⚠️ Hype spike detected — capture a screen tab first to enable auto-clip'
      );
      await expect(page.locator('#chatStatus')).not.toContainText('Auto-clipping');
      await expect(page.locator('#clipper'), 'Clip attribution must not be overwritten').toHaveValue('@viewer');
      await expect(page.locator('#vaultSection')).toBeHidden();
    });

    await test.step('Click "Capture screen / Twitch tab"', async () => {
      await page.locator('#capture').click();
    });

    await test.step('Verify rolling buffer auto-starts (Buffer Active badge)', async () => {
      await expect(page.locator('#start')).toHaveText(/Buffer Active \(\d+\/30s\)/, { timeout: 10000 });
      await expect(page.locator('#status')).toContainText(/Rolling buffer (started|active)/);
    });

    await test.step('Verify "Clip last 30 seconds" and "Stop capture" are enabled', async () => {
      await expect(page.locator('#clip')).toBeEnabled();
      await expect(page.locator('#stop')).toBeEnabled();
    });

    await test.step('Hype spike after capture still auto-clips (regression guard)', async () => {
      // Give the MediaRecorder time to emit chunks so a clip can be cut
      await page.waitForTimeout(2500);
      await page.locator('#simHypeBtn').click();
      await expect(page.locator('#chatStatus')).toContainText('Auto-clipping last 30s');
      await expect(page.locator('#vaultSection')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#download')).toBeVisible();
    });

    await test.step('Detect unhandled runtime errors', async () => {
      await page.waitForTimeout(1000);
      expect(pageErrors, 'No uncaught runtime exceptions should be thrown').toEqual([]);
    });
  });

});
