import { test, expect } from './fixtures';
import { test as base, expect as baseExpect } from '@playwright/test';
import path from 'path';

/**
 * Tests for deck list, deck navigation, and file library features.
 */

test.describe('Deck List & File Library', () => {
  test('should display deck library with loaded deck', async ({ loadedDeckPage: page }) => {
    // Navigate back to deck list
    await page.getByRole('tab', { name: 'Review' }).click();

    // Should show the file library
    await expect(page.getByTestId('file-library')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deck Library' })).toBeVisible();
  });

  test('should show deck tree with card counts', async ({ loadedDeckPage: page }) => {
    // Navigate to deck list
    await page.getByRole('tab', { name: 'Review' }).click();

    // Deck tree should exist with stats
    const deckRow = page.getByTestId('deck-row').first();
    await expect(deckRow).toBeVisible();

    // Should show card count stats (new/learn/due)
    const stats = deckRow.locator('.stat');
    const statCount = await stats.count();
    expect(statCount).toBeGreaterThan(0);
  });

  test('should navigate to study view when clicking a deck', async ({ loadedDeckPage: page }) => {
    // Go to deck list
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('deck-row').first()).toBeVisible();

    // Click a deck
    await page.getByTestId('deck-row').first().click();

    // Should enter study mode with a card visible
    await expect(page.getByTestId('flash-card')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should show Add File button', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByRole('button', { name: 'Add File' })).toBeVisible();
  });

  test('should show Create Filtered Deck button', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByRole('button', { name: 'Create Filtered Deck' })).toBeVisible();
  });
});
