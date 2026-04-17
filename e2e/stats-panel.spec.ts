import { test, expect } from './fixtures';

/**
 * Tests for the Statistics panel.
 */

test.describe('Stats Panel', () => {
  test('should navigate to Stats tab', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Stats")');

    await expect(page.locator('.stats-panel')).toBeVisible();
    await expect(page.locator('.stats-title')).toHaveText('Statistics');
  });

  test('should show period selector buttons', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Stats")');
    await expect(page.locator('.stats-panel')).toBeVisible({ timeout: 10000 });

    // Period selector should be visible
    const periodSelector = page.locator('.period-selector');
    await expect(periodSelector).toBeVisible({ timeout: 10000 });

    // All period buttons should exist
    await expect(page.locator('.period-btn:has-text("1 Month")')).toBeVisible();
    await expect(page.locator('.period-btn:has-text("3 Months")')).toBeVisible();
    await expect(page.locator('.period-btn:has-text("1 Year")')).toBeVisible();
    await expect(page.locator('.period-btn:has-text("All Time")')).toBeVisible();
  });

  test('should display stats after reviewing some cards', async ({ loadedDeckPage: page }) => {
    // Review a few cards first
    for (let i = 0; i < 3; i++) {
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);
    }

    // Navigate to stats
    await page.click('.tab:has-text("Stats")');
    await expect(page.locator('.stats-panel')).toBeVisible();

    // Wait for loading to complete
    await expect(page.locator('.stats-loading')).not.toBeVisible({ timeout: 10000 });

    // Chart grid should be visible (there are multiple chart grids)
    await expect(page.locator('.chart-grid').first()).toBeVisible();
  });

  test('should switch between period views', async ({ loadedDeckPage: page }) => {
    // Review some cards
    for (let i = 0; i < 3; i++) {
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);
    }

    await page.click('.tab:has-text("Stats")');
    await expect(page.locator('.stats-panel')).toBeVisible();
    await expect(page.locator('.stats-loading')).not.toBeVisible({ timeout: 10000 });

    // Click different period buttons
    await page.click('.period-btn:has-text("3 Months")');
    await page.waitForTimeout(300);
    await expect(page.locator('.period-btn--active:has-text("3 Months")')).toBeVisible();

    await page.click('.period-btn:has-text("1 Year")');
    await page.waitForTimeout(300);
    await expect(page.locator('.period-btn--active:has-text("1 Year")')).toBeVisible();

    await page.click('.period-btn:has-text("All Time")');
    await page.waitForTimeout(300);
    await expect(page.locator('.period-btn--active:has-text("All Time")')).toBeVisible();
  });
});
