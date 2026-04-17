import { test, expect } from './fixtures';

/**
 * Tests for the Find Duplicates feature.
 */

test.describe('Find Duplicates', () => {
  test('should navigate to Find Duplicates from Browse toolbar', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Browse")');
    await expect(page.locator('.browse-table')).toBeVisible();

    await page.click('button:has-text("Find Duplicates")');

    await expect(page.locator('.find-duplicates__options')).toBeVisible();
  });

  test('should navigate to Find Duplicates via command palette', async ({
    loadedDeckPage: page,
  }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('find duplicates');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.locator('.find-duplicates__options')).toBeVisible();
  });

  test('should show search options', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find Duplicates")');

    // Field selector
    await expect(page.locator('#dup-field')).toBeVisible();

    // Scope selector
    await expect(page.locator('#dup-scope')).toBeVisible();

    // Fuzzy match checkbox
    await expect(page.locator('text=Include fuzzy matches')).toBeVisible();

    // Search button
    await expect(page.locator('button:has-text("Search for Duplicates")')).toBeVisible();
  });

  test('should run duplicate search', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find Duplicates")');

    // Click search
    await page.click('button:has-text("Search for Duplicates")');

    // Results area should appear (either groups or "No duplicates found")
    await expect(page.locator('.find-duplicates__results')).toBeVisible({ timeout: 15000 });
  });

  test('should show fuzzy threshold slider when fuzzy is enabled', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find Duplicates")');

    // Enable fuzzy matching
    const fuzzyCheckbox = page.locator('.find-duplicates__checkbox');
    await fuzzyCheckbox.click();

    // Threshold slider should appear
    await expect(page.locator('#dup-threshold')).toBeVisible();
  });

  test('should navigate back to Browse', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find Duplicates")');

    await expect(page.locator('.find-duplicates__options')).toBeVisible();

    // Click back button
    await page.click('.find-duplicates__back-btn');

    // Should be back in browse view
    await expect(page.locator('.browse-table')).toBeVisible();
  });
});
