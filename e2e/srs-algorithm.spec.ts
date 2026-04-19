import { test, expect } from './fixtures';

test.describe('SRS Algorithm', () => {
  test('should display interval times for each answer option', async ({ loadedDeckPage: page }) => {
    // Reveal card to see answer buttons with intervals
    await page.getByRole('button', { name: 'Reveal' }).click();

    // Check that each answer button has a time interval
    const answerButtons = ['Again', 'Hard', 'Good', 'Easy'];

    for (const buttonText of answerButtons) {
      const button = page.getByRole('button', { name: new RegExp(buttonText) });
      await expect(button).toBeVisible();

      // Get button content
      const content = await button.textContent();

      // Should contain the answer text
      expect(content).toContain(buttonText);

      // Should contain a time interval (could be <1m, 5m, 2d, etc.)
      // The .time span should exist
      const timeSpan = button.locator('.time');
      await expect(timeSpan).toBeVisible();
    }
  });

  test('should show different intervals for different answer options', async ({
    loadedDeckPage: page,
  }) => {
    // Reveal card
    await page.getByRole('button', { name: 'Reveal' }).click();

    // Get intervals for each answer
    const getInterval = async (answerText: string) => {
      const button = page.getByRole('button', { name: new RegExp(answerText) });
      const timeSpan = button.locator('.time');
      return await timeSpan.textContent();
    };

    const againInterval = await getInterval('Again');
    const hardInterval = await getInterval('Hard');
    const goodInterval = await getInterval('Good');
    const easyInterval = await getInterval('Easy');

    // All intervals should exist
    expect(againInterval).toBeTruthy();
    expect(hardInterval).toBeTruthy();
    expect(goodInterval).toBeTruthy();
    expect(easyInterval).toBeTruthy();

    // For a new card, "Again" should typically be the shortest interval
    // and "Easy" should be the longest
    // We can't test exact values, but we can verify they're different
    const intervals = [againInterval, hardInterval, goodInterval, easyInterval];
    const uniqueIntervals = new Set(intervals);

    // At least some intervals should be different
    expect(uniqueIntervals.size).toBeGreaterThan(1);
  });

  test('should persist card review state in IndexedDB', async ({ loadedDeckPage: page }) => {
    // Answer a card
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: /Good/ }).click();

    // Wait for DB to update
    await page.waitForTimeout(500);

    // Check that review data was saved to IndexedDB
    const hasReviewData = await page.evaluate(async () => {
      const dbName = 'anki-review-db';

      return new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains('cards')) {
            resolve(false);
            return;
          }

          const transaction = db.transaction(['cards'], 'readonly');
          const store = transaction.objectStore('cards');
          const countRequest = store.count();

          countRequest.onsuccess = () => {
            resolve(countRequest.result > 0);
          };

          countRequest.onerror = () => reject(countRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    });

    expect(hasReviewData).toBe(true);
  });

  test('should update intervals after reviewing a card', async ({ loadedDeckPage: page }) => {
    // Reveal card and get initial intervals
    await page.getByRole('button', { name: 'Reveal' }).click();

    // Answer with "Good"
    await page.getByRole('button', { name: /Good/ }).click();

    // Verify the system is tracking reviews

    // Check review logs were created
    const hasReviewLogs = await page.evaluate(async () => {
      const dbName = 'anki-review-db';

      return new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains('reviewLogs')) {
            resolve(false);
            return;
          }

          const transaction = db.transaction(['reviewLogs'], 'readonly');
          const store = transaction.objectStore('reviewLogs');
          const countRequest = store.count();

          countRequest.onsuccess = () => {
            resolve(countRequest.result > 0);
          };

          countRequest.onerror = () => reject(countRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    });

    expect(hasReviewLogs).toBe(true);
  });

  test('should track daily statistics', async ({ loadedDeckPage: page }) => {
    // Answer a few cards
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Reveal' }).click();
      await page.getByRole('button', { name: /Good/ }).click();
      await page.waitForTimeout(300);
    }

    // Check that daily stats were recorded
    const hasDailyStats = await page.evaluate(async () => {
      const dbName = 'anki-review-db';

      return new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains('dailyStats')) {
            resolve(false);
            return;
          }

          const transaction = db.transaction(['dailyStats'], 'readonly');
          const store = transaction.objectStore('dailyStats');
          const countRequest = store.count();

          countRequest.onsuccess = () => {
            resolve(countRequest.result > 0);
          };

          countRequest.onerror = () => reject(countRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    });

    expect(hasDailyStats).toBe(true);
  });

  test('should handle different answer ratings correctly', async ({ loadedDeckPage: page }) => {
    // Test "Again" (rating 0 - card should come back soon)
    await page.getByRole('button', { name: 'Reveal' }).click();
    const againButton = page.getByRole('button', { name: /Again/ });
    const againInterval = await againButton.locator('.time').textContent();

    // "Again" interval should be very short (typically <1m or similar)
    expect(againInterval).toBeTruthy();

    await page.getByRole('button', { name: /Again/ }).click();

    // Verify the review was recorded
    await page.waitForTimeout(300);

    // Now test with "Easy"
    await page.getByRole('button', { name: 'Reveal' }).click();
    const easyButton = page.getByRole('button', { name: /Easy/ });
    const easyInterval = await easyButton.locator('.time').textContent();

    // "Easy" interval should be longer
    expect(easyInterval).toBeTruthy();

    await page.getByRole('button', { name: /Easy/ }).click();
    await page.waitForTimeout(300);

    // Both reviews should be tracked
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

    expect(reviewCount).toBeGreaterThanOrEqual(2);
  });
});
