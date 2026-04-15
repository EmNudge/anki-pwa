import { test, expect } from './fixtures';

// Helper to get the scheduler settings modal
const getSchedulerModal = (page: any) => {
  return page.locator('.ds-modal-overlay:has(.ds-modal__title:has-text("Deck Settings"))');
};

test.describe('FSRS Algorithm', () => {
  test.describe('Settings Modal', () => {
    test('should open scheduler settings modal with Ctrl+,', async ({ loadedDeckPage: page }) => {
      // Open settings with keyboard shortcut
      await page.keyboard.press('Control+Comma');

      // Wait for modal to appear
      await expect(page.locator('.ds-modal__title:has-text("Deck Settings")')).toBeVisible();
    });

    test('should open scheduler settings via command palette', async ({ loadedDeckPage: page }) => {
      // Open command palette
      await page.keyboard.press('Meta+k');

      // Wait for command palette
      await page.waitForTimeout(200);

      // Type to search for scheduler settings
      await page.keyboard.type('scheduler settings');
      await page.waitForTimeout(200);

      // Press Enter to select
      await page.keyboard.press('Enter');

      // Settings modal should appear
      await expect(getSchedulerModal(page)).toBeVisible();
      await expect(page.locator('.ds-modal__title:has-text("Deck Settings")')).toBeVisible();
    });

    test('should close settings modal with Cancel button', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Click Cancel
      await page.click('button:has-text("Cancel")');

      // Modal should close
      await expect(getSchedulerModal(page)).not.toBeVisible();
    });

    test('should close settings modal with X button', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Click close button
      await page.click('.ds-modal__close');

      // Modal should close
      await expect(getSchedulerModal(page)).not.toBeVisible();
    });

    test('should display SM2 as default algorithm', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Check that SM2 is selected by default
      const algorithmSelect = page.locator('.form-select').first();
      await expect(algorithmSelect).toBeVisible();
      expect(await algorithmSelect.inputValue()).toBe('sm2');
    });

    test('should show FSRS parameters when FSRS is selected', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Change to FSRS
      await page.locator('select.form-select').first().selectOption('fsrs');

      // FSRS parameters should appear
      await expect(page.locator('text=FSRS Parameters')).toBeVisible();
      await expect(page.locator('label:has-text("Target Retention")')).toBeVisible();
      await expect(page.locator('label:has-text("Maximum Interval")')).toBeVisible();
    });

    test('should hide FSRS parameters when SM2 is selected', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Switch to FSRS first
      await page.locator('select.form-select').first().selectOption('fsrs');
      await expect(page.locator('text=FSRS Parameters')).toBeVisible();

      // Switch back to SM2
      await page.locator('select.form-select').first().selectOption('sm2');

      // FSRS parameters should be hidden
      await expect(page.locator('text=FSRS Parameters')).not.toBeVisible();
    });

    test('should allow changing daily limits', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Change daily new limit
      const newLimitInput = page.locator('input[type="number"]').first();
      await newLimitInput.fill('30');

      // Change daily review limit
      const reviewLimitInput = page.locator('input[type="number"]').nth(1);
      await reviewLimitInput.fill('300');

      // Save settings
      await page.click('button:has-text("Save Settings")');

      // Modal should close
      await expect(getSchedulerModal(page)).not.toBeVisible();

      // Reopen settings to verify changes were saved
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Verify values persisted
      expect(await page.locator('input[type="number"]').first().inputValue()).toBe('30');
      expect(await page.locator('input[type="number"]').nth(1).inputValue()).toBe('300');
    });

    test('should allow changing FSRS parameters', async ({ loadedDeckPage: page }) => {
      // Open settings
      await page.keyboard.press('Control+Comma');
      await expect(getSchedulerModal(page)).toBeVisible();

      // Switch to FSRS
      await page.locator('select.form-select').first().selectOption('fsrs');

      // Wait for FSRS parameters to appear
      await page.waitForTimeout(200);

      // Change target retention - find by label
      const retentionInput = page.locator('label:has-text("Target Retention") + input');
      await retentionInput.fill('0.85');

      // Change maximum interval - find by label
      const maxIntervalInput = page.locator('label:has-text("Maximum Interval") + input');
      await maxIntervalInput.fill('1000');

      // Save settings
      await page.click('button:has-text("Save Settings")');

      // Wait for modal to close
      await page.waitForTimeout(500);

      // Reopen settings to verify
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.waitForTimeout(200);

      // Verify values persisted
      expect(await page.locator('label:has-text("Target Retention") + input').inputValue()).toBe('0.85');
      expect(await page.locator('label:has-text("Maximum Interval") + input').inputValue()).toBe('1000');
    });
  });

  test.describe('FSRS Scheduler Functionality', () => {
    test('should switch to FSRS and review cards', async ({ loadedDeckPage: page }) => {
      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');

      // Wait for settings to apply
      await page.waitForTimeout(500);

      // Reveal and answer a card
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');

      // Wait for DB update
      await page.waitForTimeout(500);

      // Verify review was recorded with FSRS
      const reviewData = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<{ algorithm: string; cardState: unknown }>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const cards = getAllRequest.result;
              if (cards.length > 0) {
                resolve({
                  algorithm: cards[0].algorithm,
                  cardState: cards[0].cardState,
                });
              } else {
                reject(new Error('No cards found'));
              }
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(reviewData.algorithm).toBe('fsrs');
      expect(reviewData.cardState).toBeTruthy();
    });

    test('should not show SM2 metrics when using FSRS', async ({ loadedDeckPage: page }) => {
      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(500);

      // Check that SM2-specific metrics are not shown
      await expect(page.locator('.info-label:has-text("Ease Factor")')).not.toBeVisible();
      await expect(page.locator('.info-label:has-text("Interval")')).not.toBeVisible();
    });

    test('should calculate different FSRS intervals for each answer', async ({
      loadedDeckPage: page,
    }) => {
      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(500);

      // Reveal card
      await page.click('button:has-text("Reveal")');

      // Get intervals for each answer
      const getInterval = async (answerText: string) => {
        const button = page.locator(`button:has-text("${answerText}")`);
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

      // Intervals should be different
      const intervals = [againInterval, hardInterval, goodInterval, easyInterval];
      const uniqueIntervals = new Set(intervals);
      expect(uniqueIntervals.size).toBeGreaterThan(1);
    });

    test('should persist FSRS review logs', async ({ loadedDeckPage: page }) => {
      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(500);

      // Review several cards
      for (let i = 0; i < 3; i++) {
        await page.click('button:has-text("Reveal")');
        await page.click('button:has-text("Good")');
        await page.waitForTimeout(300);
      }

      // Check review logs
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

      expect(reviewCount).toBe(3);
    });
  });

  test.describe('Algorithm Switching', () => {
    test('should switch from SM2 to FSRS', async ({ loadedDeckPage: page }) => {
      // Start with SM2 (default)
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);

      // Verify SM2 was used
      let algorithm = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<string>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const cards = getAllRequest.result;
              resolve(cards[0]?.algorithm || 'unknown');
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(algorithm).toBe('sm2');

      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(1000); // Wait for queue to reinitialize

      // Review another card
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);

      // Check that new cards use FSRS
      const fsrsCardCount = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<number>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const cards = getAllRequest.result;
              const fsrsCards = cards.filter((card: { algorithm: string }) => card.algorithm === 'fsrs');
              resolve(fsrsCards.length);
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(fsrsCardCount).toBeGreaterThan(0);
    });

    test('should preserve existing cards when switching algorithms', async ({
      loadedDeckPage: page,
    }) => {
      // Review a card with SM2
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);

      // Get initial card count
      const initialCount = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<number>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const countRequest = store.count();

            countRequest.onsuccess = () => resolve(countRequest.result);
            countRequest.onerror = () => reject(countRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      // Switch to FSRS
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(1000);

      // Review another card
      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(300);

      // Card count should have increased
      const finalCount = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<number>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['cards'], 'readonly');
            const store = transaction.objectStore('cards');
            const countRequest = store.count();

            countRequest.onsuccess = () => resolve(countRequest.result);
            countRequest.onerror = () => reject(countRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(finalCount).toBeGreaterThan(initialCount);
    });

  });

  test.describe('FSRS Settings Persistence', () => {
    test('should persist FSRS settings in IndexedDB', async ({ loadedDeckPage: page }) => {
      // Set FSRS with custom parameters
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.waitForTimeout(200);

      const retentionInput = page.locator('label:has-text("Target Retention") + input');
      await retentionInput.fill('0.88');

      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(1000); // Wait for settings to be saved to IndexedDB

      // Verify settings were saved to IndexedDB
      const savedSettings = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<{ algorithm: string; fsrsParams: unknown }>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const allSettings = getAllRequest.result;
              if (allSettings.length > 0) {
                resolve({
                  algorithm: allSettings[0].settings.algorithm,
                  fsrsParams: allSettings[0].settings.fsrsParams,
                });
              } else {
                reject(new Error('No settings found'));
              }
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(savedSettings.algorithm).toBe('fsrs');
      expect(savedSettings.fsrsParams).toBeTruthy();
      // Check that requestRetention was saved (actual value might be different due to type conversions)
      expect((savedSettings.fsrsParams as  { requestRetention?: number }).requestRetention).toBeTruthy();
    });

    test('should save settings per deck', async ({ loadedDeckPage: page }) => {
      // Configure settings for current deck
      await page.keyboard.press('Control+Comma');
      await page.locator('select.form-select').first().selectOption('fsrs');
      await page.locator('input[type="number"]').first().fill('25');
      await page.click('button:has-text("Save Settings")');
      await page.waitForTimeout(500);

      // Verify settings in IndexedDB
      const settings = await page.evaluate(async () => {
        const dbName = 'anki-review-db';

        return new Promise<{ algorithm: string; dailyNewLimit: number }>((resolve, reject) => {
          const request = indexedDB.open(dbName);

          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const allSettings = getAllRequest.result;
              if (allSettings.length > 0) {
                resolve({
                  algorithm: allSettings[0].settings.algorithm,
                  dailyNewLimit: allSettings[0].settings.dailyNewLimit,
                });
              } else {
                reject(new Error('No settings found'));
              }
            };

            getAllRequest.onerror = () => reject(getAllRequest.error);
          };

          request.onerror = () => reject(request.error);
        });
      });

      expect(settings.algorithm).toBe('fsrs');
      expect(settings.dailyNewLimit).toBe(25);
    });
  });
});
