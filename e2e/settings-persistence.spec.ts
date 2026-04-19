import { test, expect } from './fixtures';

/**
 * Tests for settings persistence across page reloads.
 */

test.describe('Settings Persistence', () => {
  test('should persist daily limits after page reload', async ({ loadedDeckPage: page }) => {
    // Open settings and set custom limits
    await page.keyboard.press('Control+Comma');
    await expect(
      page.getByRole('heading', { name: 'Deck Settings' }),
    ).toBeVisible();

    const newLimitInput = page.locator('input[type="number"]').first();
    await newLimitInput.fill('42');

    const reviewLimitInput = page.locator('input[type="number"]').nth(1);
    await reviewLimitInput.fill('250');

    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForTimeout(1000);

    // Reload the page
    await page.reload({ waitUntil: 'networkidle' });

    // Wait for the deck to be available, then click it
    const deckRow = page.getByTestId('deck-row').first();
    await deckRow.waitFor({ timeout: 30000 });
    await deckRow.click();
    await page.getByTestId('flash-card').waitFor({ timeout: 30000 });

    // Reopen settings and verify values persisted
    await page.keyboard.press('Control+Comma');
    await expect(
      page.getByRole('heading', { name: 'Deck Settings' }),
    ).toBeVisible();

    expect(await page.locator('input[type="number"]').first().inputValue()).toBe('42');
    expect(await page.locator('input[type="number"]').nth(1).inputValue()).toBe('250');
  });

  test('should persist algorithm selection after page reload', async ({
    loadedDeckPage: page,
  }) => {
    // Switch to FSRS
    await page.keyboard.press('Control+Comma');
    await page.locator('select').first().selectOption('fsrs');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForTimeout(1000);

    // Reload
    await page.reload({ waitUntil: 'networkidle' });

    const deckRow = page.getByTestId('deck-row').first();
    await deckRow.waitFor({ timeout: 30000 });
    await deckRow.click();
    await page.getByTestId('flash-card').waitFor({ timeout: 30000 });

    // Reopen settings and verify FSRS is still selected
    await page.keyboard.press('Control+Comma');
    const algorithmSelect = page.locator('select').first();
    expect(await algorithmSelect.inputValue()).toBe('fsrs');
  });
});
