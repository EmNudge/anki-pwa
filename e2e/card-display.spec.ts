import { test, expect } from './fixtures';

test.describe('Card Display', () => {
  test('should display a card with front side initially', async ({ loadedDeckPage: page }) => {
    // Check that card exists
    const card = page.locator('.card');
    await expect(card).toBeVisible();

    // Check that Reveal button is visible (indicating front side)
    const revealButton = page.locator('button:has-text("Reveal")');
    await expect(revealButton).toBeVisible();

    // Check that answer buttons are not visible yet
    await expect(page.locator('button:has-text("Again")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Hard")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Good")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Easy")')).not.toBeVisible();
  });

  test('should show front content on initial load', async ({ loadedDeckPage: page }) => {
    const cardContent = page.locator('.card-content');
    await expect(cardContent).toBeVisible();

    // Content is rendered inside a sandboxed iframe
    const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
    const body = iframe.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('should reveal back side when Reveal button is clicked', async ({ loadedDeckPage: page }) => {
    // Click Reveal button
    await page.click('button:has-text("Reveal")');

    // Wait for answer buttons to appear
    await expect(page.locator('button:has-text("Again")')).toBeVisible();
    await expect(page.locator('button:has-text("Hard")')).toBeVisible();
    await expect(page.locator('button:has-text("Good")')).toBeVisible();
    await expect(page.locator('button:has-text("Easy")')).toBeVisible();

    // Reveal button should not be visible anymore
    await expect(page.locator('button:has-text("Reveal")')).not.toBeVisible();
  });

  test('should display different content on front and back', async ({ loadedDeckPage: page }) => {
    const iframe = page.frameLocator('.card-content iframe.sandboxed-card');

    // Get front content
    const frontContent = await iframe.locator('body').textContent();

    // Reveal back
    await page.click('button:has-text("Reveal")');

    // Get back content (iframe reloads with new content)
    await page.waitForTimeout(500);
    const backContent = await iframe.locator('body').textContent();

    // Back content should include front content (as per Anki spec with FrontSide)
    expect(backContent).toContain(frontContent);
    // Back content should have additional content beyond just the front
    expect(backContent?.length).toBeGreaterThan(frontContent?.length ?? 0);
  });

  test('should have proper card structure', async ({ loadedDeckPage: page }) => {
    const card = page.locator('.card');
    await expect(card).toBeVisible();

    // Check card has content area
    const cardContent = page.locator('.card-content');
    await expect(cardContent).toBeVisible();

    // Check card has button area (buttons are now rendered using design system)
    const buttons = page.locator('button.ds-button, .button-set');
    await expect(buttons.first()).toBeVisible();
  });
});

test.describe('Card Navigation', () => {
  test('should move to next card after answering', async ({ loadedDeckPage: page }) => {
    // Reveal and answer
    await page.click('button:has-text("Reveal")');
    await page.click('button:has-text("Good")');

    // Wait for card to update
    await page.waitForTimeout(500);

    // Check that we're back to front side (next card loaded)
    await expect(page.locator('button:has-text("Reveal")')).toBeVisible();

    // Verify card content still exists inside iframe
    const iframe = page.frameLocator('.card-content iframe.sandboxed-card');
    const body = iframe.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('should cycle through answer options correctly', async ({ loadedDeckPage: page }) => {
    // Reveal card
    await page.click('button:has-text("Reveal")');

    // Test each answer button
    const answerButtons = ['Again', 'Hard', 'Good', 'Easy'];

    for (const buttonText of answerButtons) {
      const button = page.locator(`button:has-text("${buttonText}")`);
      await expect(button).toBeVisible();
    }
  });
});
