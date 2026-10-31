import { test, expect } from '@playwright/test';

/**
 * Autonomous Reproduction Spec synthesized by GhostPR (AutoFix AI)
 * Session ID: qc_bt6mrt8n
 * Title: QuickCast Tab Recording 10/28/2026
 * Target: https://miladmet.github.io/streamclip-ai-/
 *
 * Bug: Rolling 30s buffer never auto-starts on page load.
 *   - "Clip last 30 seconds" button is permanently disabled until user manually
 *     clicks "Start rolling buffer" — no auto-init occurs.
 *   - Recording (keyframes @ 5s, 10s, 20s) shows "Buffer Active (30/30s)" badge
 *     already active with the Clip button enabled, meaning prior behavior was
 *     to auto-initialize the buffer on load.
 *   - On the current live site, the buffer status is inactive and the Clip button
 *     is disabled, blocking the core clipping workflow.
 */

test.describe('GhostPR Automated Bug Reproduction — qc_bt6mrt8n', () => {

  test('Autonomous E2E reproduction and state verification', async ({ page }) => {
    // Hoist error trap BEFORE navigation to capture boot & hydration exceptions
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Navigation to recorded target entrypoint
    await page.goto('https://miladmet.github.io/streamclip-ai-/', { waitUntil: 'networkidle' });

    await test.step('Verify initial target page load & layout', async () => {
      await expect(page).toHaveURL(/miladmet\.github\.io\/streamclip\-ai\-\//);
      await expect(page.locator('body')).toBeVisible();
      await expect(page).toHaveTitle(/StreamClip AI/);
    });

    await test.step('Verify Clip controls panel renders with correct input defaults', async () => {
      // Confirmed via probe: #channel and #clipper have values from recording session
      await expect(page.locator('#channel')).toBeVisible();
      await expect(page.locator('#channel')).toHaveValue('riotgames');
      await expect(page.locator('#clipper')).toHaveValue('@viewer');
    });

    await test.step('Verify rolling buffer auto-initializes on page load (Buffer Active badge)', async () => {
      // Recording keyframes at 5s, 10s, 20s all show "Buffer Active (30/30s)" —
      // the buffer should be running without requiring manual user interaction.
      // BUG: on the live site this button reads "Start rolling buffer" instead,
      // confirming the auto-init regressed.
      await expect(
        page.locator('button', { hasText: /Buffer Active/i })
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step('Verify "Clip last 30 seconds" button is enabled when buffer is active', async () => {
      // Core workflow gate: this button must be enabled when buffer is running.
      // BUG: isEnabled() returns false on current live site — button is disabled.
      const clipBtn = page.locator('button', { hasText: /Clip last 30 seconds/i });
      await expect(clipBtn).toBeVisible();
      await expect(clipBtn).toBeEnabled();
    });

    await test.step('Inspect critical UI components and detect unhandled errors', async () => {
      await page.waitForTimeout(1000);
      expect(pageErrors.length, 'No uncaught runtime exceptions should be thrown').toBe(0);
    });
  });

});
