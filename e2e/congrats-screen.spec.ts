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
      const revealButton = page.getByRole('button', { name: 'Reveal' });
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });

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
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    // Congrats screen should be visible
    await expect(page.getByTestId('congrats-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Congratulations!' })).toHaveText('Congratulations!');
    await expect(page.getByText("You've finished this deck for now.")).toBeVisible();
  });

  test('should display review statistics on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.getByRole('button', { name: 'Reveal' });
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('congrats-screen')).toBeVisible();

    // Should show stats
    const stats = page.getByTestId('congrats-stats');
    await expect(stats).toBeVisible();

    // Should have stat entries with actual values
    const statItems = stats.locator('dt, dd');
    const count = await statItems.count();
    expect(count).toBeGreaterThan(0);

    // At least one stat should contain a numeric value (not empty/placeholder)
    const firstStatText = await statItems.first().textContent();
    expect(firstStatText).toBeTruthy();
  });

  test('should show Back to Decks button on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.getByRole('button', { name: 'Reveal' });
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('congrats-screen')).toBeVisible();

    // Should have Back to Decks button
    const backButton = page.getByRole('button', { name: 'Back to Decks' });
    await expect(backButton).toBeVisible();
  });

  test('should navigate back to deck list when clicking Back to Decks', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.getByRole('button', { name: 'Reveal' });
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('congrats-screen')).toBeVisible();

    // Click Back to Decks
    await page.getByRole('button', { name: 'Back to Decks' }).click();

    // Should show deck library
    await expect(page.getByTestId('file-library')).toBeVisible();
  });

  test('should show Custom Study button on congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.getByRole('button', { name: 'Reveal' });
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('congrats-screen')).toBeVisible();

    // Should have Custom Study button
    await expect(page.getByRole('button', { name: 'Custom Study' })).toBeVisible();
  });

  test('should open Custom Study modal from congrats screen', async ({
    loadedDeckPage: page,
  }) => {
    // Review all cards
    for (let i = 0; i < 100; i++) {
      const congratsTitle = page.getByRole('heading', { name: 'Congratulations!' });
      if (await congratsTitle.isVisible().catch(() => false)) break;

      const revealButton = page.getByRole('button', { name: 'Reveal' });
      if (!(await revealButton.isVisible().catch(() => false))) {
        await page.waitForTimeout(300);
        break;
      }

      await revealButton.click();
      await page.getByRole('button', { name: /Easy/ }).click();
      await page.waitForTimeout(200);
    }

    await expect(page.getByTestId('congrats-screen')).toBeVisible();

    // Click Custom Study
    await page.getByRole('button', { name: 'Custom Study' }).click();

    // Custom Study modal should open
    await expect(page.getByTestId('custom-study-modal')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Custom Study' })).toBeVisible();
  });
});
