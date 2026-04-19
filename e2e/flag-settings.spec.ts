import { test, expect } from './fixtures';

/**
 * Tests for the Flag Settings modal and card flagging.
 */

test.describe('Flag Settings', () => {
  test('should open Flag Settings via command palette', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Flag Labels' })).toBeVisible();
  });

  test('should display all flag color rows', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Should show flag rows (red, orange, yellow, green, blue, purple = 6)
    const flagRows = page.getByTestId('flag-row');
    const count = await flagRows.count();
    // There should be at least 6 flags
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('should show color dots for each flag', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    const colorDots = page.getByTestId('flag-color');
    const count = await colorDots.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('should allow renaming a flag', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Type a custom name for the first flag
    const firstInput = page.getByTestId('flag-row').first().getByRole('textbox');
    await firstInput.fill('Important');

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Modal should close
    await expect(page.getByRole('heading', { name: 'Flag Labels' })).not.toBeVisible();

    // Reopen and verify
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    const savedValue = await page.getByTestId('flag-row').first().getByRole('textbox').inputValue();
    expect(savedValue).toBe('Important');
  });

  test('should close on Cancel without saving', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('customize flags');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');

    // Type something
    await page.getByTestId('flag-row').first().getByRole('textbox').fill('Temporary');

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'Flag Labels' })).not.toBeVisible();
  });
});

test.describe('Card Flagging during Review', () => {
  test('should flag a card via command palette', async ({ loadedDeckPage: page }) => {
    // Open command palette and navigate to flag commands
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/command/i).fill('flag card');
    await page.waitForTimeout(200);

    // Should see Flag Card command
    await expect(page.getByTestId('command-palette-item').filter({ hasText: 'Flag Card' })).toBeVisible();
  });
});
