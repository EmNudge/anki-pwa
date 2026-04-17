import { test, expect } from './fixtures';

/**
 * Tests for the congratulations screen that appears when all reviews are complete.
 */

test.describe('Congrats Screen', () => {
  test('should show congrats screen after reviewing all due cards', async ({
    loadedDeckPage: page,
  }) => {
    // Review cards until the congrats screen appears (with a safety limit)
    const maxReviews = 100;
    for (let i = 0; i < maxReviews; i++) {
      const revealButton = page.locator('button:has-text("Reveal")');
      const congratsTitle = page.locator('.congrats-title');

      // Check if congrats screen appeared
      if (await congratsTitle.isVisible().catch(() => false)) {
        break;
      }

      // If no reveal button either, something is wrong
      if (!(await revealButton.isVisible().catch(() => false))) {
        // Wait a moment and check again
        await page.waitForTimeout(300);
        if (await congratsTitle.isVisible().catch(() => false)) {
          break;
        }
        break;
      }

      // Reveal and answer Easy to move through quickly
      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    // Congrats screen should be visible
    await expect(page.locator('.congrats')).toBeVisible();
    await expect(page.locator('.congrats-title')).toHaveText('Congratulations!');
    await expect(page.locator('.congrats-subtitle')).toBeVisible();
  });

  test('should display review statistics on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.locator('.congrats-title');
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.locator('button:has-text("Reveal")');
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.congrats')).toBeVisible();

    // Should show stats
    const stats = page.locator('.congrats-stats');
    await expect(stats).toBeVisible();

    // Should have stat entries
    const statItems = stats.locator('.stat');
    const count = await statItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show Back to Decks button on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.locator('.congrats-title');
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.locator('button:has-text("Reveal")');
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.congrats')).toBeVisible();

    // Should have Back to Decks button
    const backButton = page.locator('button:has-text("Back to Decks")');
    await expect(backButton).toBeVisible();
  });

  test('should navigate back to deck list when clicking Back to Decks', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.locator('.congrats-title');
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.locator('button:has-text("Reveal")');
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.congrats')).toBeVisible();

    // Click Back to Decks
    await page.click('button:has-text("Back to Decks")');

    // Should show deck library
    await expect(page.locator('.file-library')).toBeVisible();
  });

  test('should show Custom Study button on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.locator('.congrats-title');
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.locator('button:has-text("Reveal")');
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.congrats')).toBeVisible();

    // Should have Custom Study button
    await expect(page.locator('button:has-text("Custom Study")')).toBeVisible();
  });

  test('should open Custom Study modal from congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.locator('.congrats-title');
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.locator('button:has-text("Reveal")');
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.click('button:has-text("Easy")');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.congrats')).toBeVisible();

    // Click Custom Study
    await page.click('button:has-text("Custom Study")');

    // Custom Study modal should open
    await expect(page.locator('.custom-study')).toBeVisible();
    await expect(page.locator('.ds-modal__title:has-text("Custom Study")')).toBeVisible();
  });
});
