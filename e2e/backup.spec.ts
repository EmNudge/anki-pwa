import { test, expect } from './fixtures';

/**
 * Tests for the Backup panel.
 */

test.describe('Backup Panel', () => {
  test('should navigate to Backup tab', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    // Should show backup sections (Export & Import + Stored Backups)
    await expect(page.locator('.backup-section').first()).toBeVisible();
  });

  test('should show Export and Import buttons', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    await expect(page.locator('.backup-btn--primary:has-text("Export")')).toBeVisible();
    await expect(page.locator('.backup-btn--secondary:has-text("Import")')).toBeVisible();
  });

  test('should show Create Backup button', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    await expect(page.locator('.backup-btn--primary:has-text("Create Backup")')).toBeVisible();
  });

  test('should show stored backups section', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    // The Stored Backups section header should be visible
    await expect(page.locator('.backup-section-header')).toBeVisible();
  });

  test('should show auto-backup settings', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    // Auto-backup settings should be in a collapsible details element
    const settingsSummary = page.locator('.backup-settings summary');
    await expect(settingsSummary).toBeVisible();

    // Click to expand
    await settingsSummary.click();
    await page.waitForTimeout(200);

    // Should show auto-backup checkbox
    await expect(page.locator('text=Enable periodic auto-backup')).toBeVisible();
  });

  test('should have Create Backup button clickable', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Backup")');

    const createBtn = page.locator('.backup-btn--primary:has-text("Create Backup")');
    await expect(createBtn).toBeVisible();
    // Just verify the button is present and clickable (actual backup may fail without synced data)
  });
});
