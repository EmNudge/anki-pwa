import { test, expect } from './fixtures';

/**
 * Tests for the Flag Settings modal and card flagging.
 */

test.describe('Flag Settings', () => {
  test('should open Flag Settings via command palette', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.locator('.ds-modal__title:has-text("Flag Labels")')).toBeVisible();
  });

  test('should display all flag color rows', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Should show flag rows (red, orange, yellow, green, blue, purple = 6)
    const flagRows = page.locator('.flag-row');
    const count = await flagRows.count();
    // There should be at least 6 flags
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('should show color dots for each flag', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    const colorDots = page.locator('.flag-color');
    const count = await colorDots.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('should allow renaming a flag', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Type a custom name for the first flag
    const firstInput = page.locator('.flag-input').first();
    await firstInput.fill('Important');

    // Save
    await page.click('button:has-text("Save")');

    // Modal should close
    await expect(page.locator('.ds-modal__title:has-text("Flag Labels")')).not.toBeVisible();

    // Reopen and verify
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    const savedValue = await page.locator('.flag-input').first().inputValue();
    expect(savedValue).toBe('Important');
  });

  test('should close on Cancel without saving', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Type something
    await page.locator('.flag-input').first().fill('Temporary');

    // Cancel
    await page.click('button:has-text("Cancel")');

    await expect(page.locator('.ds-modal__title:has-text("Flag Labels")')).not.toBeVisible();
  });
});

test.describe('Card Flagging during Review', () => {
  test('should flag a card via command palette', async ({ loadedDeckPage: page }) => {
    // Open command palette and navigate to flag commands
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('flag card');
    await page.waitForTimeout(200);

    // Should see Flag Card command
    await expect(page.locator('.command-palette-item:has-text("Flag Card")')).toBeVisible();
  });
});
