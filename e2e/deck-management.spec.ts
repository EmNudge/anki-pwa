import { test, expect } from './fixtures';
import { test as base, expect as baseExpect } from '@playwright/test';
import path from 'path';

/**
 * Tests for deck list, deck navigation, and file library features.
 */

test.describe('Deck List & File Library', () => {
  test('should display deck library with loaded deck', async ({ loadedDeckPage: page }) => {
    // Navigate back to deck list
    await page.click('.tab:has-text("Review")');

    // Should show the file library
    await expect(page.locator('.file-library')).toBeVisible();
    await expect(page.locator('.title:has-text("Deck Library")')).toBeVisible();
  });

  test('should show deck tree with card counts', async ({ loadedDeckPage: page }) => {
    // Navigate to deck list
    await page.click('.tab:has-text("Review")');

    // Deck tree should exist with stats
    const deckRow = page.locator('.deck-row').first();
    await expect(deckRow).toBeVisible();

    // Should show card count stats (new/learn/due)
    const stats = deckRow.locator('.stat');
    const statCount = await stats.count();
    expect(statCount).toBeGreaterThan(0);
  });

  test('should navigate to study view when clicking a deck', async ({ loadedDeckPage: page }) => {
    // Go to deck list
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('.deck-row').first()).toBeVisible();

    // Click a deck
    await page.locator('.deck-row').first().click();

    // Should enter study mode with a card visible
    await expect(page.locator('.card')).toBeVisible();
    await expect(page.locator('button:has-text("Reveal")')).toBeVisible();
  });

  test('should show Add File button', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('button:has-text("Add File")')).toBeVisible();
  });

  test('should show Create Filtered Deck button', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('button:has-text("Create Filtered Deck")')).toBeVisible();
  });
});
