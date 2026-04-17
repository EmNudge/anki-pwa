import { test, expect } from './fixtures';

const MOBILE_VIEWPORT = { width: 375, height: 667 }; // iPhone SE

interface OverflowInfo {
  selector: string;
  tagName: string;
  rect: { left: number; right: number; width: number; top: number };
  overflow: number;
  text: string;
}

async function findOverflowingElements(page: import('@playwright/test').Page): Promise<OverflowInfo[]> {
  return page.evaluate(() => {
    const htmlWidth = document.documentElement.clientWidth;
    const results: OverflowInfo[] = [];
    const all = document.querySelectorAll('*');

    // Check if an element is inside a scrollable container
    function isInsideScrollable(el: Element): boolean {
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        const overflowX = style.overflowX;
        if ((overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') &&
            parent.scrollWidth > parent.clientWidth) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }

    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > htmlWidth + 1) {
        if (isInsideScrollable(el)) continue;

        // Build a rough selector for debugging
        let selector = el.tagName.toLowerCase();
        if (el.id) selector += `#${el.id}`;
        if (el.className && typeof el.className === 'string') {
          selector += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
        }

        results.push({
          selector,
          tagName: el.tagName,
          rect: { left: rect.left, right: rect.right, width: rect.width, top: rect.top },
          overflow: Math.round(rect.right - htmlWidth),
          text: (el.textContent || '').slice(0, 80).trim(),
        });
      }
    }
    return results;
  });
}

test.describe('Mobile responsiveness', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('deck list has no horizontal overflow', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const overflows = await findOverflowingElements(page);
    if (overflows.length > 0) {
      console.log('Overflowing elements on deck list (empty state):');
      for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
    }
    expect(overflows).toEqual([]);
  });

  test('study view has no horizontal overflow', async ({ loadedDeckPage: page }) => {
    const overflows = await findOverflowingElements(page);
    if (overflows.length > 0) {
      console.log('Overflowing elements on study view:');
      for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
    }
    expect(overflows).toEqual([]);
  });

  test('study view answer revealed has no horizontal overflow', async ({ loadedDeckPage: page }) => {
    // Reveal the answer
    await page.click('.card');
    await page.waitForTimeout(300);

    const overflows = await findOverflowingElements(page);
    if (overflows.length > 0) {
      console.log('Overflowing elements on answer view:');
      for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
    }
    expect(overflows).toEqual([]);
  });

  test('stats panel has no horizontal overflow', async ({ loadedDeckPage: page }) => {
    // Open stats panel - look for stats button
    const statsBtn = page.locator('button:has-text("Stats"), [aria-label*="stats" i], [aria-label*="Stats"]').first();
    if (await statsBtn.isVisible()) {
      await statsBtn.click();
      await page.waitForTimeout(500);

      const overflows = await findOverflowingElements(page);
      if (overflows.length > 0) {
        console.log('Overflowing elements on stats panel:');
        for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
      }
      expect(overflows).toEqual([]);
    }
  });

  test('browse view has no horizontal overflow', async ({ loadedDeckPage: page }) => {
    // Open browse - look for browse button
    const browseBtn = page.locator('button:has-text("Browse"), [aria-label*="browse" i]').first();
    if (await browseBtn.isVisible()) {
      await browseBtn.click();
      await page.waitForTimeout(500);

      const overflows = await findOverflowingElements(page);
      if (overflows.length > 0) {
        console.log('Overflowing elements on browse view:');
        for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
      }
      expect(overflows).toEqual([]);
    }
  });

  test('sync view has no horizontal overflow', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Navigate to sync tab
    const syncTab = page.locator('button.tab:has-text("Sync")');
    if (await syncTab.isVisible()) {
      await syncTab.click();
      await page.waitForTimeout(500);

      const overflows = await findOverflowingElements(page);
      if (overflows.length > 0) {
        console.log('Overflowing elements on sync view:');
        for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
      }
      expect(overflows).toEqual([]);
    }
  });

  test('create deck view has no horizontal overflow', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const createTab = page.locator('button.tab:has-text("Create Deck")');
    if (await createTab.isVisible()) {
      await createTab.click();
      await page.waitForTimeout(500);

      const overflows = await findOverflowingElements(page);
      if (overflows.length > 0) {
        console.log('Overflowing elements on create deck view:');
        for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
      }
      expect(overflows).toEqual([]);
    }
  });

  test('backup view has no horizontal overflow', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const backupTab = page.locator('button.tab:has-text("Backup")');
    if (await backupTab.isVisible()) {
      await backupTab.click();
      await page.waitForTimeout(500);

      const overflows = await findOverflowingElements(page);
      if (overflows.length > 0) {
        console.log('Overflowing elements on backup view:');
        for (const o of overflows) console.log(`  ${o.selector} overflows by ${o.overflow}px (right=${o.rect.right})`);
      }
      expect(overflows).toEqual([]);
    }
  });
});
