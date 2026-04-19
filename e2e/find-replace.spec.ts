import { test, expect } from './fixtures';

/**
 * Tests for the Find & Replace modal.
 */

test.describe('Find & Replace', () => {
  test('should open Find & Replace from Browse toolbar', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.getByTestId('browse-table')).toBeVisible();

    await page.getByRole('button', { name: 'Find & Replace' }).click();

    await expect(page.getByRole('heading', { name: 'Find & Replace' })).toBeVisible();
  });

  test('should show find and replace input fields', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    // Find input
    const findInput = page.locator('.fr-form').getByRole('textbox').first();
    await expect(findInput).toBeVisible();

    // Replace input
    const replaceInput = page.locator('.fr-form').getByRole('textbox').nth(1);
    await expect(replaceInput).toBeVisible();
  });

  test('should show toggle options', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    // Toggle checkboxes for regex, case-sensitive, whole word
    const toggles = page.locator('.fr-row--options').getByRole('checkbox');
    const count = await toggles.count();
    expect(count).toBe(3);
  });

  test('should show scope and field dropdowns', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    // Field selector
    const fieldSelect = page.locator('.fr-form select').first();
    await expect(fieldSelect).toBeVisible();

    // Scope selector
    const scopeSelect = page.locator('.fr-form select').nth(1);
    await expect(scopeSelect).toBeVisible();
  });

  test('should preview changes when typing search text', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    // Type a search term that likely exists in music interval cards
    const findInput = page.locator('.fr-form').getByRole('textbox').first();
    await findInput.fill('interval');

    const replaceInput = page.locator('.fr-form').getByRole('textbox').nth(1);
    await replaceInput.fill('INTERVAL');

    await page.waitForTimeout(500);

    // Preview should show matches or "No matches found"
    const preview = page.getByTestId('fr-preview');
    await expect(preview).toBeVisible();
  });

  test('should show "No matches found" for non-existent text', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    const findInput = page.locator('.fr-form').getByRole('textbox').first();
    await findInput.fill('zzz_nonexistent_text_zzz');
    await page.waitForTimeout(500);

    // Should show no matches message
    const previewText = await page.getByTestId('fr-preview').textContent();
    expect(previewText).toContain('No matches');
  });

  test('should close modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    await expect(page.getByRole('heading', { name: 'Find & Replace' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'Find & Replace' })).not.toBeVisible();
  });

  test('should disable Replace All when no matches', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByRole('button', { name: 'Find & Replace' }).click();

    const findInput = page.locator('.fr-form').getByRole('textbox').first();
    await findInput.fill('zzz_nonexistent_zzz');
    await page.waitForTimeout(500);

    // Replace All button should be disabled
    const replaceBtn = page.getByRole('button', { name: 'Replace all' });
    await expect(replaceBtn).toBeDisabled();
  });
});
