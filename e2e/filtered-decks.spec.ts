import { test, expect } from './fixtures';

/**
 * Tests for filtered deck creation and custom study features.
 */

test.describe('Filtered Decks', () => {
  test('should open Create Filtered Deck modal from file library', async ({
    loadedDeckPage: page,
  }) => {
    // Navigate to deck list
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('file-library')).toBeVisible();

    // Click Create Filtered Deck
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    // Modal should open
    await expect(
      page.getByRole('heading', { name: 'Create Filtered Deck' }),
    ).toBeVisible();
    await expect(page.getByTestId('filtered-form')).toBeVisible();
  });

  test('should show form fields in filtered deck modal', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    // Check form fields
    await expect(page.getByText('Name')).toBeVisible();
    await expect(page.getByText('Search query')).toBeVisible();
    await expect(page.getByText('Limit')).toBeVisible();
    await expect(page.getByText('Sort order')).toBeVisible();

    // Check reschedule checkbox
    await expect(
      page.getByText('Reschedule cards based on my answers'),
    ).toBeVisible();
  });

  test('should show matching card count as user types query', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    // Type a wildcard query to match all cards
    const queryInput = page.getByTestId('filtered-form').getByRole('textbox').nth(1);
    await queryInput.fill('is:new');

    // Should show matching card count in the hint
    await page.waitForTimeout(500);
    const hint = page.locator('.field-hint').first();
    await expect(hint).toBeVisible();
    const hintText = await hint.textContent();
    expect(hintText).toMatch(/\d+\s*(cards?|matching)/i);
  });

  test('should show preview bar with card count', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    const queryInput = page.getByTestId('filtered-form').getByRole('textbox').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    // Preview bar should show card count
    const previewBar = page.getByTestId('preview-bar');
    await expect(previewBar).toBeVisible();
    const previewText = await previewBar.textContent();
    expect(previewText).toMatch(/will study \d+ card/i);
  });

  test('should close filtered deck modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    await expect(page.getByTestId('filtered-form')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should close
    await expect(page.getByTestId('filtered-form')).not.toBeVisible();
  });

  test('should create a filtered deck and start studying it', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    // Fill in the form
    const nameInput = page.getByTestId('filtered-form').getByRole('textbox').first();
    await nameInput.fill('Test Filtered Deck');

    // Use a query that matches card content
    const queryInput = page.getByTestId('filtered-form').getByRole('textbox').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    // Wait for the Create button to become enabled (effectiveCount > 0)
    const createBtn = page.getByTestId('filtered-form').getByRole('button', { name: 'Create' });
    if (await createBtn.isDisabled()) {
      await queryInput.fill('deck:*');
      await page.waitForTimeout(500);
    }
    if (await createBtn.isDisabled()) {
      await queryInput.fill('a');
      await page.waitForTimeout(500);
    }

    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // After creation, app starts studying the filtered deck immediately
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('filtered-form')).not.toBeVisible();

    // Should be in study mode — card or congrats screen visible
    const studyVisible = await page.getByTestId('flash-card').isVisible().catch(() => false);
    const congratsVisible = await page.getByTestId('congrats-screen').isVisible().catch(() => false);
    expect(studyVisible || congratsVisible).toBe(true);

    // Go back to deck list to verify the filtered deck appears there
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('file-library')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('filtered-deck-card')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Test Filtered Deck')).toBeVisible();
  });

  test('should delete a filtered deck', async ({ loadedDeckPage: page }) => {
    // First create a filtered deck
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Create Filtered Deck' }).click();

    const nameInput = page.getByTestId('filtered-form').getByRole('textbox').first();
    await nameInput.fill('Deck To Delete');

    const queryInput = page.getByTestId('filtered-form').getByRole('textbox').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    const createBtn = page.getByTestId('filtered-form').getByRole('button', { name: 'Create' });
    if (await createBtn.isDisabled()) {
      await queryInput.fill('deck:*');
      await page.waitForTimeout(500);
    }
    if (await createBtn.isDisabled()) {
      await queryInput.fill('a');
      await page.waitForTimeout(500);
    }

    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();
    await page.waitForTimeout(1000);

    // After creation, go back to deck list
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByTestId('file-library')).toBeVisible({ timeout: 5000 });

    // Verify it exists
    await expect(page.getByText('Deck To Delete')).toBeVisible({ timeout: 5000 });

    // Click delete button on the filtered deck
    const filteredCard = page.getByTestId('filtered-deck-card').filter({ hasText: 'Deck To Delete' });
    await filteredCard.locator('button[title="Delete"]').click();

    // Filtered deck should be removed
    await expect(page.getByText('Deck To Delete')).not.toBeVisible();
  });
});

test.describe('Custom Study Modal', () => {
  test('should display all preset options', async ({ loadedDeckPage: page }) => {
    // Get to congrats screen first by reviewing all cards
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

    // Open Custom Study modal
    await page.getByRole('button', { name: 'Custom Study' }).click();
    await expect(page.getByTestId('custom-study-modal')).toBeVisible();

    // Check all presets are shown
    const modal = page.getByTestId('custom-study-modal');
    const presets = modal.getByRole('button');
    const count = await presets.count();
    // 5 presets + Cancel button
    expect(count).toBeGreaterThanOrEqual(5);

    // Verify preset labels
    await expect(modal.getByText('Review forgotten cards')).toBeVisible();
    await expect(modal.getByText('Review ahead').first()).toBeVisible();
    await expect(modal.getByText('Preview new cards')).toBeVisible();
    await expect(modal.getByText('Study by state: due')).toBeVisible();
    await expect(modal.getByText('Cram all cards')).toBeVisible();
  });

  test('should close Custom Study modal on Cancel', async ({ loadedDeckPage: page }) => {
    // Get to congrats screen
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

    await page.getByRole('button', { name: 'Custom Study' }).click();
    await expect(page.locator('.custom-study')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.custom-study')).not.toBeVisible();
  });

  test('should select a preset and close the modal', async ({
    loadedDeckPage: page,
  }) => {
    // Get to congrats screen
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

    await page.getByRole('button', { name: 'Custom Study' }).click();
    await expect(page.locator('.custom-study')).toBeVisible();

    // Click "Cram all cards" preset
    await page.locator('.preset-btn:has-text("Cram all cards")').click();

    // The Custom Study modal should close after selecting a preset
    await expect(page.locator('.custom-study')).not.toBeVisible({ timeout: 10000 });
  });
});
