import { test, expect } from './fixtures';

/**
 * Tests for the Note Type Manager modal.
 * Note: Full note type data requires a synced collection with SQLite data.
 * With a loaded .apkg file, the note type list may be empty.
 */

test.describe('Note Type Manager', () => {
  test('should open via command palette', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('manage note types');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Manage Note Types' })).toBeVisible();
  });

  test('should show sidebar and detail layout', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('manage note types');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Manage Note Types' })).toBeVisible();

    // Sidebar should be visible
    await expect(page.getByTestId('sidebar')).toBeVisible();

    // Search input should be available
    await expect(page.getByTestId('sidebar').getByRole('textbox')).toBeVisible();

    // New button should be in sidebar actions
    await expect(page.locator('.sidebar-actions button').first()).toBeVisible();
  });

  test('should close modal', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('manage note types');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Manage Note Types' })).toBeVisible();

    await page.getByRole('button', { name: /close/i }).click();

    await expect(page.getByRole('heading', { name: 'Manage Note Types' })).not.toBeVisible();
  });
});
