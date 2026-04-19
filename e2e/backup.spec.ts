import { test, expect } from './fixtures';

/**
 * Tests for the Backup panel.
 */

test.describe('Backup Panel', () => {
  test('should navigate to Backup tab', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    // Should show backup sections (Export & Import + Stored Backups)
    await expect(page.getByTestId('backup-section').first()).toBeVisible();
  });

  test('should show Export and Import buttons', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    await expect(page.getByRole('button', { name: 'Export Collection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Collection' })).toBeVisible();
  });

  test('should show Create Backup button', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    await expect(page.getByRole('button', { name: 'Create Backup' })).toBeVisible();
  });

  test('should show stored backups section', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    // The Stored Backups section header should be visible
    await expect(page.getByRole('heading', { name: 'Stored Backups' })).toBeVisible();
  });

  test('should show auto-backup settings', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    // Auto-backup settings should be in a collapsible details element
    const settingsSummary = page.locator('.backup-settings summary');
    await expect(settingsSummary).toBeVisible();

    // Click to expand
    await settingsSummary.click();
    await page.waitForTimeout(200);

    // Should show auto-backup checkbox
    await expect(page.getByText('Enable periodic auto-backup')).toBeVisible();
  });

  test('should have Create Backup button clickable', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Backup' }).click();

    const createBtn = page.getByRole('button', { name: 'Create Backup' });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // After clicking, button state should change (disabled while in progress, or a download triggers)
    // Just verify the button click doesn't throw and the page remains functional
    await expect(createBtn).toBeVisible();
  });
});
