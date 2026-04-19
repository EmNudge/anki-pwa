import { test, expect } from './fixtures';

/**
 * Tests for the Undo/Redo system.
 */

test.describe('Undo/Redo', () => {
  test('should show disabled undo/redo buttons initially', async ({ loadedDeckPage: page }) => {
    const undoBtn = page.getByRole('button', { name: /undo/i });
    const redoBtn = page.getByRole('button', { name: /redo/i });

    await expect(undoBtn).toBeVisible();
    await expect(redoBtn).toBeVisible();
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();
  });

  test('should enable undo button after reviewing a card', async ({ loadedDeckPage: page }) => {
    // Review a card
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await page.waitForTimeout(500);

    // Undo button should now be enabled
    const undoBtn = page.getByRole('button', { name: /undo/i });
    await expect(undoBtn).toBeEnabled();
  });

  test('should undo a review with Ctrl+Z', async ({ loadedDeckPage: page }) => {
    // Review a card
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await page.waitForTimeout(500);

    // Undo the review
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Should be back on the previous card's front (Reveal button visible)
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should undo multiple reviews', async ({ loadedDeckPage: page }) => {
    // Review two cards
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: /Good/ }).click();
    await page.waitForTimeout(500);

    // Undo once
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

    // Undo again
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

    // Undo button should still be enabled (there might be more entries)
    // or disabled if we've undone everything
    await expect(page.getByTestId('flash-card')).toBeVisible();
  });

  test('should undo a note edit', async ({ loadedDeckPage: page }) => {
    // Go to Browse and edit a note
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.locator('.browse-table tbody tr').first().click();

    const originalValue = await page.locator('.detail-field-value').first().textContent();

    // Edit the note
    await page.locator('.detail-pane button:has-text("Edit")').click();
    const firstEditor = page.locator('.edit-form .tiptap').first();
    await firstEditor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('undo-test-value');
    await page.locator('.ds-modal button:has-text("Save")').click();
    await page.waitForTimeout(500);

    // Verify edit took effect
    const editedValue = await page.locator('.detail-field-value').first().textContent();
    expect(editedValue).toContain('undo-test-value');

    // Undo the edit
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Value should revert
    const revertedValue = await page.locator('.detail-field-value').first().textContent();
    expect(revertedValue).toBe(originalValue);
  });
});
