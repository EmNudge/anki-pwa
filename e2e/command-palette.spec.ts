import { test, expect } from './fixtures';

/**
 * Tests for the Command Palette (Ctrl+K / Cmd+K).
 */

test.describe('Command Palette', () => {
  test('should open with Ctrl+K', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');

    await expect(page.locator('.command-palette')).toBeVisible();
    await expect(page.locator('.command-palette-input')).toBeVisible();
    await expect(page.locator('.command-palette-input')).toBeFocused();
  });

  test('should close with Escape', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.command-palette')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.command-palette')).not.toBeVisible();
  });

  test('should close when clicking overlay', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.command-palette')).toBeVisible();

    await page.locator('.command-palette-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.command-palette')).not.toBeVisible();
  });

  test('should display command items', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');

    const items = page.locator('.command-palette-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should filter commands by search text', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');

    const initialCount = await page.locator('.command-palette-item').count();

    await page.locator('.command-palette-input').fill('scheduler');
    await page.waitForTimeout(200);

    const filteredCount = await page.locator('.command-palette-item').count();
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('should navigate commands with arrow keys', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.command-palette-item.selected')).toBeVisible();

    // Press down arrow
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // A different item should be selected
    const selectedItems = page.locator('.command-palette-item.selected');
    const count = await selectedItems.count();
    expect(count).toBe(1);
  });

  test('should execute command on Enter', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('scheduler settings');
    await page.waitForTimeout(200);

    await page.keyboard.press('Enter');

    // Scheduler settings modal should open
    await expect(page.locator('.ds-modal__title:has-text("Deck Settings")')).toBeVisible();
    // Palette should close
    await expect(page.locator('.command-palette')).not.toBeVisible();
  });

  test('should execute command on click', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('toggle theme');
    await page.waitForTimeout(200);

    await page.locator('.command-palette-item').first().click();

    // Palette should close
    await expect(page.locator('.command-palette')).not.toBeVisible();
  });

  test('should navigate to Browse via command palette', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-input').fill('go to browse');
    await page.waitForTimeout(200);

    await page.keyboard.press('Enter');

    await expect(page.locator('.browse-table')).toBeVisible();
  });

  test('should show footer hints', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Control+k');

    const footer = page.locator('.command-palette-footer');
    await expect(footer).toBeVisible();
  });
});
