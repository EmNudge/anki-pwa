import { test, expect } from './fixtures';

/**
 * Tests for the Find & Replace modal.
 */

test.describe('Find & Replace', () => {
  test('should open Find & Replace from Browse toolbar', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await expect(page.locator('.browse-table')).toBeVisible();

    await page.click('button:has-text("Find & Replace")');

    await expect(page.locator('.ds-modal__title:has-text("Find & Replace")')).toBeVisible();
  });

  test('should show find and replace input fields', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    // Find input
    const findInput = page.locator('.fr-input').first();
    await expect(findInput).toBeVisible();

    // Replace input
    const replaceInput = page.locator('.fr-input').nth(1);
    await expect(replaceInput).toBeVisible();
  });

  test('should show toggle options', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    // Toggle checkboxes for regex, case-sensitive, whole word
    const toggles = page.locator('.fr-toggle input[type="checkbox"]');
    const count = await toggles.count();
    expect(count).toBe(3);
  });

  test('should show scope and field dropdowns', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    // Field selector
    const fieldSelect = page.locator('.fr-select').first();
    await expect(fieldSelect).toBeVisible();

    // Scope selector
    const scopeSelect = page.locator('.fr-select').nth(1);
    await expect(scopeSelect).toBeVisible();
  });

  test('should preview changes when typing search text', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    // Type a search term that likely exists in music interval cards
    const findInput = page.locator('.fr-input').first();
    await findInput.fill('interval');

    const replaceInput = page.locator('.fr-input').nth(1);
    await replaceInput.fill('INTERVAL');

    await page.waitForTimeout(500);

    // Preview should show matches or "No matches found"
    const preview = page.locator('.fr-preview');
    await expect(preview).toBeVisible();
  });

  test('should show "No matches found" for non-existent text', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    const findInput = page.locator('.fr-input').first();
    await findInput.fill('zzz_nonexistent_text_zzz');
    await page.waitForTimeout(500);

    // Should show no matches message
    const previewText = await page.locator('.fr-preview').textContent();
    expect(previewText).toContain('No matches');
  });

  test('should close modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    await expect(page.locator('.ds-modal__title:has-text("Find & Replace")')).toBeVisible();

    await page.click('button:has-text("Cancel")');

    await expect(page.locator('.ds-modal__title:has-text("Find & Replace")')).not.toBeVisible();
  });

  test('should disable Replace All when no matches', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Browse")');
    await page.click('button:has-text("Find & Replace")');

    const findInput = page.locator('.fr-input').first();
    await findInput.fill('zzz_nonexistent_zzz');
    await page.waitForTimeout(500);

    // Replace All button should be disabled
    const replaceBtn = page.locator('button:has-text("Replace all")');
    await expect(replaceBtn).toBeDisabled();
  });
});
