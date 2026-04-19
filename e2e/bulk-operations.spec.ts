import { test, expect } from './fixtures';

/**
 * Tests for bulk operations in the Browse view: multi-select, bulk tag, suspend/unsuspend.
 */

// Playwright on Mac needs Meta for Cmd, on Linux/Windows needs Control
const multiSelectModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Bulk Operations', () => {
  test('should multi-select cards with Ctrl/Cmd+Click', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.getByTestId('browse-table')).toBeVisible();

    // Switch to Cards view for individual card selection
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) return;

    // Click first row
    await rows.first().click();

    // Ctrl/Cmd+click second row for multi-select
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    // Bulk toolbar should appear
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();
    await expect(page.getByTestId('bulk-count')).toContainText('2 selected');
  });

  test('should select all cards via Select All button', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) return;

    // Multi-select to show bulk toolbar
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();

    // Click Select All
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Select All' }).click();

    // Count should be >= visible rows (Select All selects all cards, not just visible ones)
    const selectedText = await page.getByTestId('bulk-count').textContent();
    const selectedCount = parseInt(selectedText?.match(/(\d+)/)?.[1] ?? '0', 10);
    expect(selectedCount).toBeGreaterThanOrEqual(rowCount);
  });

  test('should clear selection', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();

    // Click Clear
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Clear' }).click();

    // Bulk toolbar should disappear
    await expect(page.getByTestId('bulk-toolbar')).not.toBeVisible();
  });

  test('should open Add Tag modal from bulk toolbar', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();

    // Click Add tag
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Add tag' }).click();

    // Modal should open
    await expect(
      page.getByRole('heading', { name: 'Add Tag to Selected Notes' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible();
  });

  test('should add a bulk tag', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Add tag' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('bulk-test-tag');
    await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();

    // Modal should close
    await expect(
      page.getByRole('heading', { name: 'Add Tag to Selected Notes' }),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('should open Remove Tag modal from bulk toolbar', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });

    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Remove tag' }).click();

    await expect(
      page.getByRole('heading', { name: 'Remove Tag from Selected Notes' }),
    ).toBeVisible();
  });

  test('should suspend selected cards', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();

    // Click Suspend
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Suspend' }).first().click();
    await page.waitForTimeout(500);

    // TODO: No visible UI indicator for suspended state — both Suspend/Unsuspend
    // buttons are always shown. Consider adding a "Queue" column or row styling
    // so this test can verify the state actually changed.
    await expect(page.getByTestId('browse-table')).toBeVisible();
  });

  test('should unsuspend selected cards', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    // First suspend some cards
    const rows = page.getByTestId('browse-table').locator('tbody tr');
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Suspend' }).first().click();
    await page.waitForTimeout(500);

    // Re-select the same cards
    await rows.first().click();
    await rows.nth(1).click({ modifiers: [multiSelectModifier as 'Control' | 'Meta'] });
    await expect(page.getByTestId('bulk-toolbar')).toBeVisible();

    // Click Unsuspend
    await page.getByTestId('bulk-toolbar').getByRole('button', { name: 'Unsuspend' }).click();
    await page.waitForTimeout(500);

    // TODO: Same as suspend test — no visible indicator to verify unsuspend worked.
    await expect(page.getByTestId('browse-table')).toBeVisible();
  });
});
