import { test, expect } from './fixtures';

/**
 * Tests for the Statistics panel.
 */

test.describe('Stats Panel', () => {
  test('should navigate to Stats tab', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Stats' }).click();

    await expect(page.getByTestId('stats-panel')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  });

  test('should show period selector buttons', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByTestId('stats-panel')).toBeVisible({ timeout: 10000 });

    // Period selector should be visible
    const periodSelector = page.getByTestId('period-selector');
    await expect(periodSelector).toBeVisible({ timeout: 10000 });

    // All period buttons should exist
    await expect(page.getByRole('button', { name: '1 Month' })).toBeVisible();
    await expect(page.getByRole('button', { name: '3 Months' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 Year' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
  });

  test('should display stats after reviewing some cards', async ({ loadedDeckPage: page }) => {
    // Review a few cards first
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Reveal' }).click();
      await page.getByRole('button', { name: /Good/ }).click();
      await page.waitForTimeout(300);
    }

    // Navigate to stats
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByTestId('stats-panel')).toBeVisible();

    // Wait for loading to complete
    await expect(page.getByText('Loading statistics')).not.toBeVisible({ timeout: 10000 });

    // Chart grid should be visible (there are multiple chart grids)
    await expect(page.getByTestId('chart-grid').first()).toBeVisible();
  });

  test('should switch between period views', async ({ loadedDeckPage: page }) => {
    // Review some cards
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Reveal' }).click();
      await page.getByRole('button', { name: /Good/ }).click();
      await page.waitForTimeout(300);
    }

    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByTestId('stats-panel')).toBeVisible();
    await expect(page.getByText('Loading statistics')).not.toBeVisible({ timeout: 10000 });

    // Click different period buttons
    await page.getByRole('button', { name: '3 Months' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: '3 Months' })).toBeVisible();

    await page.getByRole('button', { name: '1 Year' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: '1 Year' })).toBeVisible();

    await page.getByRole('button', { name: 'All Time' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
  });
});
