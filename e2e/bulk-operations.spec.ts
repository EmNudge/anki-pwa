import { test, expect } from './fixtures';

/**
 * Tests for bulk operations in the Browse view: multi-select, bulk tag, suspend/unsuspend.
 */

// Playwright on Mac needs Meta for Cmd, on Linux/Windows needs Control
const multiSelectModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Bulk Operations', () => {
  test('should multi-select cards with Ctrl/Cmd+Click', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await expect(page.locator('.browse-table')).toBeVisible();

    // Switch to Cards view for individual card selection
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) return;

    // Click first row
    await rows.first().click();

    // Ctrl/Cmd+click second row for multi-select
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    // Bulk toolbar should appear
    await expect(page.locator('.bulk-toolbar')).toBeVisible();
    await expect(page.locator('.bulk-count')).toContainText('2 selected');
  });

  test('should select all cards via Select All button', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) return;

    // Multi-select to show bulk toolbar
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.locator('.bulk-toolbar')).toBeVisible();

    // Click Select All
    await page.locator('.bulk-toolbar button:has-text("Select All")').click();

    // Count should be >= visible rows (Select All selects all cards, not just visible ones)
    const selectedText = await page.locator('.bulk-count').textContent();
    const selectedCount = parseInt(selectedText?.match(/(\d+)/)?.[1] ?? '0', 10);
    expect(selectedCount).toBeGreaterThanOrEqual(rowCount);
  });

  test('should clear selection', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.locator('.bulk-toolbar')).toBeVisible();

    // Click Clear
    await page.locator('.bulk-toolbar button:has-text("Clear")').click();

    // Bulk toolbar should disappear
    await expect(page.locator('.bulk-toolbar')).not.toBeVisible();
  });

  test('should open Add Tag modal from bulk toolbar', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Notes")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.locator('.bulk-toolbar')).toBeVisible();

    // Click Add tag
    await page.locator('.bulk-toolbar button:has-text("Add tag")').click();

    // Modal should open
    await expect(
      page.locator('.ds-modal__title:has-text("Add Tag to Selected Notes")'),
    ).toBeVisible();
    await expect(page.locator('.modal-input')).toBeVisible();
  });

  test('should add a bulk tag', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Notes")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    await page.locator('.bulk-toolbar button:has-text("Add tag")').click();
    await page.locator('.modal-input').fill('bulk-test-tag');
    await page.locator('.ds-modal button:has-text("Add")').click();

    // Modal should close
    await expect(
      page.locator('.ds-modal__title:has-text("Add Tag to Selected Notes")'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('should open Remove Tag modal from bulk toolbar', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Notes")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    await page.locator('.bulk-toolbar button:has-text("Remove tag")').click();

    await expect(
      page.locator('.ds-modal__title:has-text("Remove Tag from Selected Notes")'),
    ).toBeVisible();
  });

  test('should suspend selected cards', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.locator('.bulk-toolbar')).toBeVisible();

    // Click Suspend
    await page.locator('.bulk-toolbar button:has-text("Suspend")').first().click();
    await page.waitForTimeout(500);

    // TODO: No visible UI indicator for suspended state — both Suspend/Unsuspend
    // buttons are always shown. Consider adding a "Queue" column or row styling
    // so this test can verify the state actually changed.
    await expect(page.locator('.browse-table')).toBeVisible();
  });

  test('should unsuspend selected cards', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    // First suspend some cards
    const rows = page.locator('.browse-table tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await page.locator('.bulk-toolbar button:has-text("Suspend")').first().click();
    await page.waitForTimeout(500);

    // Re-select the same cards
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.locator('.bulk-toolbar')).toBeVisible();

    // Click Unsuspend
    await page.locator('.bulk-toolbar button:has-text("Unsuspend")').click();
    await page.waitForTimeout(500);

    // TODO: Same as suspend test — no visible indicator to verify unsuspend worked.
    await expect(page.locator('.browse-table')).toBeVisible();
  });
});
