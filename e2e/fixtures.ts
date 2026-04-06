import { test as base, type Page } from '@playwright/test';
import path from 'path';

/**
 * Helper to load an Anki deck file into the application
 */
async function loadAnkiDeck(page: Page, filename: string = 'example_music_intervals.apkg') {
  const fs = await import('fs');
  const deckPath = path.join(process.cwd(), 'src/ankiParser/__tests__', filename);

  // Read the file from disk
  const fileBuffer = fs.readFileSync(deckPath);

  // Load the deck programmatically by creating a File object in the browser
  await page.evaluate(async (fileDataArray) => {
    // Convert the array back to a Uint8Array, then to a Blob
    const uint8Array = new Uint8Array(fileDataArray);
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });

    // Store in cache
    const cache = await caches.open('anki-cache');
    await cache.put('anki-deck', new Response(blob));

    // Trigger a page reload to load from cache
    window.location.reload();
  }, Array.from(fileBuffer));

  // Wait for page to reload
  await page.waitForLoadState('networkidle');

  // Wait for the FilePicker to be removed or card to appear
  await page.waitForSelector('.card', { timeout: 30000 });
}

/**
 * Helper to clear IndexedDB (review data)
 */
async function clearReviewData(page: Page) {
  await page.evaluate(async () => {
    const dbName = 'anki-review-db';
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        // If blocked, still resolve - the database will be deleted when connections close
        console.warn('IndexedDB deletion blocked, continuing anyway');
        resolve();
      };
    });
  });
}

/**
 * Helper to clear the deck cache
 */
async function clearDeckCache(page: Page) {
  await page.evaluate(async () => {
    const cache = await caches.open('anki-cache');
    await cache.delete('anki-deck');
  });
}

/**
 * Helper to clear localStorage
 */
async function clearLocalStorage(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
  });
}

/**
 * Extended test fixture with deck loading utilities
 */
export const test = base.extend<{
  loadedDeckPage: Page;
}>({
  loadedDeckPage: async ({ page }, use) => {
    // Clear any existing data
    await page.goto('/', { waitUntil: 'networkidle' });
    await clearLocalStorage(page);
    await clearReviewData(page);
    await clearDeckCache(page);

    // Reload to ensure clean state
    await page.reload({ waitUntil: 'networkidle' });

    // Load the test deck
    await loadAnkiDeck(page);

    // Use the page with loaded deck
    await use(page);
  },
});

export { expect } from '@playwright/test';
