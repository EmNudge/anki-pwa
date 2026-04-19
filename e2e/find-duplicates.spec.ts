import { test, expect } from './fixtures';

/**
 * Tests for the Find Duplicates feature.
 */

test.describe('Find Duplicates', () => {
  test('should navigate to Find Duplicates from Browse toolbar', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.getByTestId('browse-table')).toBeVisible();

    await page.getByRole('button', { name: 'Find Duplicates' }).click();

    await expect(page.getByTestId('find-duplicates-options')).toBeVisible();
  });

  test('should navigate to Find Duplicates via command palette', async ({
    loadedDeckPage: page,
  }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('find duplicates');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('find-duplicates-options')).toBeVisible();
  });

  test('should show search options', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find Duplicates' }).click();

    // Field selector
    await expect(page.locator('#dup-field')).toBeVisible();

    // Scope selector
    await expect(page.locator('#dup-scope')).toBeVisible();

    // Fuzzy match checkbox
    await expect(page.getByText('Include fuzzy matches')).toBeVisible();

    // Search button
    await expect(page.getByRole('button', { name: 'Search for Duplicates' })).toBeVisible();
  });

  test('should run duplicate search', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find Duplicates' }).click();

    // Click search
    await page.getByRole('button', { name: 'Search for Duplicates' }).click();

    // Results area should appear (either groups or "No duplicates found")
    await expect(page.getByTestId('find-duplicates-results')).toBeVisible({ timeout: 15000 });
  });

  test('should show fuzzy threshold slider when fuzzy is enabled', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find Duplicates' }).click();

    // Enable fuzzy matching
    await page.getByLabel('Include fuzzy matches').click();

    // Threshold slider should appear
    await expect(page.locator('#dup-threshold')).toBeVisible();
  });

  test('should navigate back to Browse', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find Duplicates' }).click();

    await expect(page.getByTestId('find-duplicates-options')).toBeVisible();

    // Click back button
    await page.getByRole('button', { name: 'Back to Browse' }).click();

    // Should be back in browse view
    await expect(page.getByTestId('browse-table')).toBeVisible();
  });
});
