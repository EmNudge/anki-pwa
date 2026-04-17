import { test, expect } from './fixtures';

/**
 * Tests for filtered deck creation and custom study features.
 */

test.describe('Filtered Decks', () => {
  test('should open Create Filtered Deck modal from file library', async ({
    loadedDeckPage: page,
  }) => {
    // Navigate to deck list
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('.file-library')).toBeVisible();

    // Click Create Filtered Deck
    await page.click('button:has-text("Create Filtered Deck")');

    // Modal should open
    await expect(
      page.locator('.ds-modal__title:has-text("Create Filtered Deck")'),
    ).toBeVisible();
    await expect(page.locator('.filtered-form')).toBeVisible();
  });

  test('should show form fields in filtered deck modal', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    // Check form fields
    await expect(page.locator('.field-label:has-text("Name")')).toBeVisible();
    await expect(page.locator('.field-label:has-text("Search query")')).toBeVisible();
    await expect(page.locator('.field-label:has-text("Limit")')).toBeVisible();
    await expect(page.locator('.field-label:has-text("Sort order")')).toBeVisible();

    // Check reschedule checkbox
    await expect(
      page.locator('text=Reschedule cards based on my answers'),
    ).toBeVisible();
  });

  test('should show matching card count as user types query', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    // Type a wildcard query to match all cards
    const queryInput = page.locator('.filtered-form .field-input').nth(1);
    await queryInput.fill('is:new');

    // Should show matching card count in the hint
    await page.waitForTimeout(500);
    const hint = page.locator('.field-hint').first();
    await expect(hint).toBeVisible();
    const hintText = await hint.textContent();
    expect(hintText).toMatch(/\d+\s*(cards?|matching)/i);
  });

  test('should show preview bar with card count', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    const queryInput = page.locator('.filtered-form .field-input').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    // Preview bar should show card count
    const previewBar = page.locator('.preview-bar');
    await expect(previewBar).toBeVisible();
    const previewText = await previewBar.textContent();
    expect(previewText).toMatch(/will study \d+ card/i);
  });

  test('should close filtered deck modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    await expect(page.locator('.filtered-form')).toBeVisible();

    // Click Cancel
    await page.locator('.form-actions button:has-text("Cancel")').click();

    // Modal should close
    await expect(page.locator('.filtered-form')).not.toBeVisible();
  });

  test('should create a filtered deck and start studying it', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    // Fill in the form
    const nameInput = page.locator('.filtered-form .field-input').first();
    await nameInput.fill('Test Filtered Deck');

    // Use a query that matches card content
    const queryInput = page.locator('.filtered-form .field-input').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    // Wait for the Create button to become enabled (effectiveCount > 0)
    const createBtn = page.locator('.form-actions button:has-text("Create")');
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
    await expect(page.locator('.filtered-form')).not.toBeVisible();

    // Should be in study mode — card or congrats screen visible
    const studyVisible = await page.locator('.card').isVisible().catch(() => false);
    const congratsVisible = await page.locator('.congrats').isVisible().catch(() => false);
    expect(studyVisible || congratsVisible).toBe(true);

    // Go back to deck list to verify the filtered deck appears there
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('.file-library')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.file-card--filtered')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.file-name:has-text("Test Filtered Deck")')).toBeVisible();
  });

  test('should delete a filtered deck', async ({ loadedDeckPage: page }) => {
    // First create a filtered deck
    await page.click('.tab:has-text("Review")');
    await page.click('button:has-text("Create Filtered Deck")');

    const nameInput = page.locator('.filtered-form .field-input').first();
    await nameInput.fill('Deck To Delete');

    const queryInput = page.locator('.filtered-form .field-input').nth(1);
    await queryInput.fill('is:new');
    await page.waitForTimeout(500);

    const createBtn = page.locator('.form-actions button:has-text("Create")');
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
    await page.click('.tab:has-text("Review")');
    await expect(page.locator('.file-library')).toBeVisible({ timeout: 5000 });

    // Verify it exists
    await expect(page.locator('.file-name:has-text("Deck To Delete")')).toBeVisible({ timeout: 5000 });

    // Click delete button on the filtered deck
    const filteredCard = page.locator('.file-card--filtered:has(.file-name:has-text("Deck To Delete"))');
    await filteredCard.locator('.delete-btn').click();

    // Filtered deck should be removed
    await expect(page.locator('.file-name:has-text("Deck To Delete")')).not.toBeVisible();
  });
});

test.describe('Custom Study Modal', () => {
  test('should display all preset options', async ({ loadedDeckPage: page }) => {
    // Get to congrats screen first by reviewing all cards
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

    // Open Custom Study modal
    await page.click('button:has-text("Custom Study")');
    await expect(page.locator('.custom-study')).toBeVisible();

    // Check all presets are shown
    const presets = page.locator('.preset-btn');
    const count = await presets.count();
    expect(count).toBe(5);

    // Verify preset labels
    await expect(page.locator('.preset-label:has-text("Review forgotten cards")')).toBeVisible();
    await expect(page.locator('.preset-label:has-text("Review ahead")')).toBeVisible();
    await expect(page.locator('.preset-label:has-text("Preview new cards")')).toBeVisible();
    await expect(page.locator('.preset-label:has-text("Study by state: due")')).toBeVisible();
    await expect(page.locator('.preset-label:has-text("Cram all cards")')).toBeVisible();
  });

  test('should close Custom Study modal on Cancel', async ({ loadedDeckPage: page }) => {
    // Get to congrats screen
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

    await page.click('button:has-text("Custom Study")');
    await expect(page.locator('.custom-study')).toBeVisible();

    // Click Cancel
    await page.click('.custom-study-footer button:has-text("Cancel")');
    await expect(page.locator('.custom-study')).not.toBeVisible();
  });

  test('should select a preset and close the modal', async ({
    loadedDeckPage: page,
  }) => {
    // Get to congrats screen
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

    await page.click('button:has-text("Custom Study")');
    await expect(page.locator('.custom-study')).toBeVisible();

    // Click "Cram all cards" preset
    await page.locator('.preset-btn:has-text("Cram all cards")').click();

    // The Custom Study modal should close after selecting a preset
    await expect(page.locator('.custom-study')).not.toBeVisible({ timeout: 10000 });
  });
});
