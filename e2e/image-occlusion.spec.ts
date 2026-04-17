import { test as base, expect, type Page } from '@playwright/test';
import { clearAppState, buildSyncedDb, loadSyncedDb, type IONoteSpec } from './fixtures';

// ─── IO-specific helpers ─────────────────────────────────────────────

/** Cycle through study cards until an IO card (.io-container in iframe) is found. */
async function findIOCard(page: Page): Promise<boolean> {
  const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
  for (let i = 0; i < 50; i++) {
    if (await iframe.locator('.io-container').count() > 0) return true;
    const reveal = page.locator('button:has-text("Reveal")');
    if (await reveal.isVisible()) await reveal.click();
    const good = page.locator('button:has-text("Good")');
    if (await good.isVisible()) { await good.click(); await page.waitForTimeout(300); }
    if (await page.locator('text=Congratulations').isVisible()) return false;
  }
  return false;
}

/** Set up a clean page with a synced DB containing the given IO notes. */
async function setupSyncedPage(page: Page, ioNotes?: IONoteSpec[]) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await clearAppState(page);
  await page.reload({ waitUntil: 'networkidle' });
  const bytes = await buildSyncedDb(page, ioNotes);
  await loadSyncedDb(page, bytes);
}

// ─── Fixtures ────────────────────────────────────────────────────────

/** Synced collection with only a basic note (no IO). */
const test = base.extend<{ syncedPage: Page }>({
  syncedPage: async ({ page }, use) => {
    await setupSyncedPage(page);
    await use(page);
  },
});

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Image Occlusion', () => {
  test.describe('Study View Rendering', () => {
    test('should render IO card front with masks', async ({ page }) => {
      await setupSyncedPage(page, [{}]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      await expect(iframe.locator('.io-container')).toBeVisible();
      await expect(iframe.locator('.io-container img')).toBeVisible();
      await expect(iframe.locator('.io-overlay')).toBeVisible();
      await expect(iframe.locator('.io-mask-active')).toBeVisible();
      await expect(iframe.locator('.io-header')).toContainText('Test IO Header');
    });

    test('should render IO card back with reveal', async ({ page }) => {
      await setupSyncedPage(page, [{}]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      await page.click('button:has-text("Reveal")');
      await page.waitForTimeout(300);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      await expect(iframe.locator('.io-mask-reveal')).toBeVisible();
      await expect(iframe.locator('.io-back-extra')).toContainText('Test Back Extra');
      await expect(page.locator('button:has-text("Again")')).toBeVisible();
      await expect(page.locator('button:has-text("Good")')).toBeVisible();
    });

    test('should advance to next card after answering IO card', async ({ page }) => {
      await setupSyncedPage(page, [{}]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      await page.click('button:has-text("Reveal")');
      await page.click('button:has-text("Good")');
      await page.waitForTimeout(500);

      await expect(page.locator('button:has-text("Reveal")')).toBeVisible();
    });
  });

  test.describe('Hide-All-Guess-One Mode', () => {
    test('should show all masks on front', async ({ page }) => {
      await setupSyncedPage(page, [{ mode: 'hide-all-guess-one' }]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      const maskCount = await iframe.locator('.io-mask, .io-mask-active').count();
      expect(maskCount).toBeGreaterThanOrEqual(3);
      expect(await iframe.locator('.io-mask-active').count()).toBe(1);
    });

    test('should keep non-active masks on back', async ({ page }) => {
      await setupSyncedPage(page, [{ mode: 'hide-all-guess-one' }]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      await page.click('button:has-text("Reveal")');
      await page.waitForTimeout(300);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      await expect(iframe.locator('.io-mask-reveal')).toBeVisible();
      expect(await iframe.locator('.io-mask:not(.io-mask-active):not(.io-mask-reveal)').count()).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Hide-One Mode', () => {
    test('should show only active mask on front', async ({ page }) => {
      await setupSyncedPage(page, [{ mode: 'hide-one' }]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      expect(await iframe.locator('.io-mask-active').count()).toBe(1);
      expect(await iframe.locator('.io-mask, .io-mask-active').count()).toBe(1);
    });

    test('should show only active reveal on back', async ({ page }) => {
      await setupSyncedPage(page, [{ mode: 'hide-one' }]);

      const found = await findIOCard(page);
      expect(found).toBe(true);

      await page.click('button:has-text("Reveal")');
      await page.waitForTimeout(300);

      const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
      expect(await iframe.locator('.io-mask-reveal').count()).toBe(1);
      expect(await iframe.locator('.io-mask:not(.io-mask-active):not(.io-mask-reveal)').count()).toBe(0);
    });
  });

  test.describe('IO Note Creation UI', () => {
    test('should show +IO button for synced collections', async ({ syncedPage: page }) => {
      await expect(page.locator('.io-add-btn')).toBeVisible();
      await expect(page.locator('.io-add-btn')).toHaveText('+IO');
    });

    test('should open IO creation modal when +IO is clicked', async ({ syncedPage: page }) => {
      await page.click('.io-add-btn');
      await expect(page.locator('.ds-modal__title:has-text("New Image Occlusion")')).toBeVisible();
      await expect(page.locator('.io-image-picker')).toBeVisible();
      await expect(page.locator('.io-note-editor button:has-text("Save")')).toBeDisabled();
    });

    test('should close IO modal on Cancel', async ({ syncedPage: page }) => {
      await page.click('.io-add-btn');
      await expect(page.locator('.ds-modal__title:has-text("New Image Occlusion")')).toBeVisible();
      await page.locator('.io-note-editor button:has-text("Cancel")').click();
      await expect(page.locator('.ds-modal__title:has-text("New Image Occlusion")')).not.toBeVisible();
    });

    test('should load image into editor via file input', async ({ syncedPage: page }) => {
      await page.click('.io-add-btn');
      await expect(page.locator('.io-image-picker')).toBeVisible();
      await page.locator('.io-picker-input').setInputFiles({
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'),
      });
      await expect(page.locator('.io-image-picker')).not.toBeVisible();
      await expect(page.locator('.io-canvas')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Browse View', () => {
    test('should display IO note with correct fields in browse', async ({ page }) => {
      await setupSyncedPage(page, [{ header: 'Browse IO Test' }]);

      await page.click('.tab:has-text("Browse")');
      await expect(page.locator('.browse-table')).toBeVisible();
      await page.locator('button.toggle-btn:has-text("Notes")').click();
      await page.waitForTimeout(300);

      const rows = page.locator('.browse-table tbody tr');
      let foundIO = false;
      for (let i = 0; i < await rows.count(); i++) {
        await rows.nth(i).click();
        await page.waitForTimeout(200);
        const labels = await page.locator('.detail-field-label').allTextContents();
        if (labels.some(l => l.toLowerCase().includes('occlusions'))) {
          foundIO = true;
          expect(labels.some(l => l.toLowerCase().includes('image occlusion'))).toBe(true);
          expect(labels.some(l => l.toLowerCase().includes('header'))).toBe(true);
          expect(labels.some(l => l.toLowerCase().includes('back extra'))).toBe(true);
          break;
        }
      }
      expect(foundIO).toBe(true);
    });

    test('should create 3 cards from one IO note with 3 shapes', async ({ page }) => {
      await setupSyncedPage(page, [{ header: 'Multi-Card IO', numShapes: 3 }]);

      await page.click('.tab:has-text("Browse")');
      await page.locator('button.toggle-btn:has-text("Cards")').click();
      await page.waitForTimeout(300);

      const rows = page.locator('.browse-table tbody tr');
      let ioCardCount = 0;
      for (let i = 0; i < await rows.count(); i++) {
        await rows.nth(i).click();
        await page.waitForTimeout(150);
        const labels = await page.locator('.detail-field-label').allTextContents();
        if (labels.some(l => l.toLowerCase().includes('occlusions'))) {
          const values = await page.locator('.detail-field-value').allTextContents();
          if (values.some(v => v.includes('Multi-Card IO'))) ioCardCount++;
        }
      }
      expect(ioCardCount).toBe(3);
    });
  });

  test.describe('IO Card Editing', () => {
    test('should open IO editor when editing an IO card', async ({ page }) => {
      await setupSyncedPage(page, [{ header: 'Edit IO Test' }]);

      await page.click('.tab:has-text("Browse")');
      await page.locator('button.toggle-btn:has-text("Notes")').click();
      await page.waitForTimeout(300);

      const rows = page.locator('.browse-table tbody tr');
      for (let i = 0; i < await rows.count(); i++) {
        await rows.nth(i).click();
        await page.waitForTimeout(200);
        const labels = await page.locator('.detail-field-label').allTextContents();
        if (labels.some(l => l.toLowerCase().includes('occlusions'))) {
          await page.locator('.detail-pane button:has-text("Edit")').click();
          await expect(page.locator('.io-note-editor')).toBeVisible();
          break;
        }
      }
    });
  });
});
