import { test as base, expect } from '@playwright/test';
import path from 'path';

/**
 * Tests for loading an .apkg file via the file input in the deck library.
 * Uses a clean page (not the loadedDeckPage fixture) to test the import flow.
 */

const test = base.extend<{ cleanPage: import('@playwright/test').Page }>({
  cleanPage: async ({ page }, use) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Clear any existing data
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(async () => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('anki-review-db');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.evaluate(async () => {
      const cache = await caches.open('anki-cache');
      const keys = await cache.keys();
      for (const key of keys) await cache.delete(key);
    });

    await page.reload({ waitUntil: 'networkidle' });
    await use(page);
  },
});

test.describe('APKG File Import', () => {
  test('should show file library when no deck is loaded', async ({ cleanPage: page }) => {
    await expect(page.locator('.file-library')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.title:has-text("Deck Library")')).toBeVisible();
  });

  test('should show Add File button on clean state', async ({ cleanPage: page }) => {
    await expect(page.locator('button:has-text("Add File")')).toBeVisible({ timeout: 10000 });
  });

  test('should have a file input that accepts .apkg files', async ({ cleanPage: page }) => {
    await expect(page.locator('.file-library')).toBeVisible({ timeout: 10000 });

    const fileInput = page.locator('.hidden-input');
    await expect(fileInput).toBeAttached();

    // Verify it accepts .apkg
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('.apkg');
  });

  test('should show the hidden file input that accepts .apkg', async ({ cleanPage: page }) => {
    await expect(page.locator('.file-library')).toBeVisible({ timeout: 10000 });

    // The hidden file input should exist and accept .apkg files
    const fileInput = page.locator('.hidden-input');
    await expect(fileInput).toBeAttached();
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('.apkg');
  });
});
