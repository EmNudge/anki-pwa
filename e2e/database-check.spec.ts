import { test, expect } from './fixtures';

/**
 * Tests for the Database Check panel.
 * Note: The Check Database button requires a synced collection with SQLite data.
 * With a loaded .apkg file, the button is disabled — so we only test UI presence.
 */

test.describe('Database Check', () => {
  test('should navigate to Check Database via command palette', async ({
    loadedDeckPage: page,
  }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('check database');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // The check database panel should be visible
    await expect(page.locator('.db-check__actions')).toBeVisible();
  });

  test('should show Check Database button (disabled without synced data)', async ({
    loadedDeckPage: page,
  }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('check database');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    const checkBtn = page.locator('button:has-text("Check Database")');
    await expect(checkBtn).toBeVisible();

    // Button is disabled when no synced SQLite data is available
    await expect(checkBtn).toBeDisabled();
  });

  test('should navigate back to Browse', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('check database');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.locator('.db-check__actions')).toBeVisible();

    // Click back button
    await page.click('.db-check__back-btn');

    // Should return to browse view
    await expect(page.locator('.browse-table')).toBeVisible();
  });
});
