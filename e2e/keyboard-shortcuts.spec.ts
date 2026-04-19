import { test, expect } from './fixtures';

test.describe('Keyboard Shortcuts', () => {
  test('should reveal card with Space key', async ({ loadedDeckPage: page }) => {
    // Verify we're on front side
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

    // Press Space to reveal
    await page.keyboard.press('Space');

    // Answer buttons should appear
    await expect(page.getByRole('button', { name: /Again/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hard/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Good/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Easy/ })).toBeVisible();
  });

  test('should reveal card with Enter key', async ({ loadedDeckPage: page }) => {
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Again/ })).toBeVisible();
  });

  test('should answer with "a" key for Again', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.keyboard.press('Space');

    // Press 'a' for Again
    await page.keyboard.press('a');

    // Should move to next card (Reveal button visible again)
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with "h" key for Hard', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.keyboard.press('Space');

    // Press 'h' for Hard
    await page.keyboard.press('h');

    // Should move to next card
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with "g" key for Good', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.keyboard.press('Space');

    // Press 'g' for Good
    await page.keyboard.press('g');

    // Should move to next card
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with "e" key for Easy', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.keyboard.press('Space');

    // Press 'e' for Easy
    await page.keyboard.press('e');

    // Should move to next card
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with numeric key "1" for Again', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Space');
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with numeric key "2" for Hard', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Space');
    await page.keyboard.press('2');
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with numeric key "3" for Good', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with numeric key "4" for Easy', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Space');
    await page.keyboard.press('4');
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should answer with Space key for Good on back side', async ({ loadedDeckPage: page }) => {
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /Good/ })).toBeVisible();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should complete full review flow with keyboard only', async ({ loadedDeckPage: page }) => {
    // Review 3 cards using only keyboard
    for (let i = 0; i < 3; i++) {
      // Verify front side
      await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

      // Reveal with Space
      await page.keyboard.press('Space');

      // Wait for back side
      await expect(page.getByRole('button', { name: /Good/ })).toBeVisible();

      // Answer with 'g' (Good)
      await page.keyboard.press('g');

      // Wait for transition
      await page.waitForTimeout(300);
    }

    // After 3 reviews, we should still have a card showing
    await expect(page.getByTestId('flash-card')).toBeVisible();
  });

  test('should ignore answer keys when on front side', async ({ loadedDeckPage: page }) => {
    // Verify we're on front side
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

    // Try pressing answer keys (should do nothing)
    await page.keyboard.press('a');
    await page.waitForTimeout(200);

    // Should still be on front side
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

    // Try another answer key
    await page.keyboard.press('g');
    await page.waitForTimeout(200);

    // Should still be on front side
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should use Space key as Good on back side', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.keyboard.press('Space');

    // Verify we're on back side
    await expect(page.getByRole('button', { name: /Again/ })).toBeVisible();

    // Press Space again (should answer Good)
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    // Should move to next card
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('should support rapid keyboard review', async ({ loadedDeckPage: page }) => {
    // Quickly review 5 cards
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space'); // Reveal
      await page.waitForTimeout(100);
      await page.keyboard.press('g'); // Good
      await page.waitForTimeout(100);
    }

    // Should complete without errors
    await expect(page.getByTestId('flash-card')).toBeVisible();

    // Verify reviews were recorded
    const reviewCount = await page.evaluate(async () => {
      const dbName = 'anki-review-db';

      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['reviewLogs'], 'readonly');
          const store = transaction.objectStore('reviewLogs');
          const countRequest = store.count();

          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    });

    expect(reviewCount).toBeGreaterThanOrEqual(5);
  });
});
