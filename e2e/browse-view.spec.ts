import { test, expect } from './fixtures';

/**
 * Tests for the Browse view — card/note browser, sorting, filtering, and view modes.
 */

test.describe('Browse View', () => {
  test('should navigate to Browse tab and show card table', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();

    await expect(page.locator('.browse-table')).toBeVisible();

    // Table should have rows
    const rows = page.locator('.browse-table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should toggle between Cards and Notes view', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.locator('.browse-table')).toBeVisible();

    // Get initial row count in Cards mode
    const initialCount = await page.locator('.browse-table tbody tr').count();

    // Switch to Notes mode
    await page.locator('button.toggle-btn:has-text("Notes")').click();
    await page.waitForTimeout(300);

    // Table should still be visible
    await expect(page.locator('.browse-table')).toBeVisible();
    const notesCount = await page.locator('.browse-table tbody tr').count();
    expect(notesCount).toBeGreaterThan(0);

    // Switch back to Cards mode
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    const cardsCount = await page.locator('.browse-table tbody tr').count();
    expect(cardsCount).toBeGreaterThan(0);
  });

  test('should select a card and show detail pane', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.locator('.browse-table')).toBeVisible();

    // Click first row
    await page.locator('.browse-table tbody tr').first().click();

    // Detail pane should be visible (not empty)
    await expect(page.locator('.detail-empty')).not.toBeVisible();
    await expect(page.locator('.detail-pane')).toBeVisible();

    // Should show field labels and values
    const fieldLabels = page.locator('.detail-field-label');
    const count = await fieldLabels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show empty state when no card is selected', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.locator('.browse-table')).toBeVisible();

    // No row selected initially — detail pane should show empty message
    await expect(page.locator('.detail-empty')).toBeVisible();
  });

  test('should sort table by clicking column headers', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.locator('.browse-table')).toBeVisible();

    // Get initial first cell text
    const firstCell = page.locator('.browse-table tbody tr').first().locator('td').first();
    const initialText = await firstCell.textContent();

    // Click the first column header to sort
    const firstHeader = page.locator('.browse-table thead th').first();
    await firstHeader.click();
    await page.waitForTimeout(300);

    // Capture text after first sort
    const afterFirstSort = await firstCell.textContent();

    // Click again to reverse sort
    await firstHeader.click();
    await page.waitForTimeout(300);

    const afterSecondSort = await firstCell.textContent();

    // At least one of the sorts should change the first row compared to initial
    // (unless there's only one row, in which case sorting can't change anything)
    const rowCount = await page.locator('.browse-table tbody tr').count();
    if (rowCount > 1) {
      const changed = afterFirstSort !== initialText || afterSecondSort !== initialText;
      expect(changed).toBe(true);
    }
  });

  test('should show card preview in detail pane', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.locator('.browse-table tbody tr').first().click();

    // Detail pane should contain field values
    const fieldValues = page.locator('.detail-field-value');
    const count = await fieldValues.count();
    expect(count).toBeGreaterThan(0);

    // At least one field should have content
    const firstValue = await fieldValues.first().textContent();
    expect(firstValue?.trim().length).toBeGreaterThan(0);
  });

  test('should show tags section in detail pane', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.locator('.browse-table tbody tr').first().click();

    // Tags area should exist in the detail pane
    await expect(page.locator('.detail-tags')).toBeVisible();
  });

  test('should update detail pane when selecting different cards', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.locator('.browse-table')).toBeVisible();

    const rows = page.locator('.browse-table tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) return; // Need at least 2 rows for this test

    // Select first row
    await rows.first().click();
    const firstFieldValue = await page.locator('.detail-field-value').first().textContent();

    // Select second row
    await rows.nth(1).click();
    await page.waitForTimeout(200);
    const secondFieldValue = await page.locator('.detail-field-value').first().textContent();

    // Values should be different (different cards)
    expect(secondFieldValue).not.toBe(firstFieldValue);
  });
});
