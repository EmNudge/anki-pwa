import { test, expect } from './fixtures';

/**
 * Tests for the CSV Import Wizard accessed via Create Deck tab.
 */

test.describe('CSV Import Wizard', () => {
  test('should navigate to Create Deck tab and show mode toggle', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');

    await expect(page.locator('.deck-creator')).toBeVisible();
    await expect(page.locator('.title:has-text("Create Deck")')).toBeVisible();

    // Mode toggle should be visible
    await expect(page.locator('.mode-btn:has-text("Manual")')).toBeVisible();
    await expect(page.locator('.mode-btn:has-text("CSV Import")')).toBeVisible();
    await expect(page.locator('.mode-btn:has-text("AI Generate")')).toBeVisible();
  });

  test('should switch to CSV Import mode and show wizard', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // CSV wizard should appear
    await expect(page.locator('.csv-wizard')).toBeVisible();

    // Should be on step 1 (Upload)
    await expect(page.locator('.step-indicator--active .step-label:has-text("Upload")')).toBeVisible();
    await expect(page.locator('.drop-zone')).toBeVisible();
    await expect(page.locator('.drop-text')).toHaveText('Drop a CSV or TSV file here');
  });

  test('should upload a CSV file and advance to Configure step', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Create a simple CSV file and upload it via the hidden file input
    const csvContent = 'Front,Back\nWhat is 2+2?,4\nWhat is 3+3?,6\nCapital of France?,Paris';
    const buffer = Buffer.from(csvContent, 'utf-8');

    const fileInput = page.locator('.file-input-hidden');
    await fileInput.setInputFiles({
      name: 'test-cards.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Should advance to Configure step
    await expect(page.locator('.step-indicator--active .step-label:has-text("Configure")')).toBeVisible();
    await expect(page.locator('.file-name')).toBeVisible();
  });

  test('should show configuration options in Configure step', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Upload CSV
    const csvContent = 'Front,Back\nQ1,A1\nQ2,A2';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Should show config options
    await expect(page.locator('.config-grid')).toBeVisible();

    // Delimiter dropdown
    const delimiterSelect = page.locator('.config-select').first();
    await expect(delimiterSelect).toBeVisible();

    // Header checkbox
    await expect(page.locator('text=First row is a header')).toBeVisible();

    // Deck name input
    const deckNameInput = page.locator('.config-input[placeholder="My Deck"]');
    await expect(deckNameInput).toBeVisible();

    // Quick preview should be visible
    await expect(page.locator('.quick-preview')).toBeVisible();
  });

  test('should advance through all wizard steps', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Step 1: Upload
    const csvContent = 'Front,Back\nWhat is 2+2?,4\nWhat is 3+3?,6';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Step 2: Configure - click Next
    await expect(page.locator('.step-indicator--active .step-label:has-text("Configure")')).toBeVisible();
    await page.click('button:has-text("Next: Map Fields")');

    // Step 3: Map Fields
    await expect(page.locator('.step-indicator--active .step-label:has-text("Map Fields")')).toBeVisible();
    await expect(page.locator('.mapping-grid')).toBeVisible();

    // Should show column mapping dropdowns
    const mappingSelects = page.locator('.mapping-grid .config-select');
    const selectCount = await mappingSelects.count();
    expect(selectCount).toBeGreaterThan(0);

    // Click Next to Preview
    await page.click('button:has-text("Next: Preview")');

    // Step 4: Preview
    await expect(page.locator('.step-indicator--active .step-label:has-text("Preview")')).toBeVisible();
    await expect(page.locator('.preview-table')).toBeVisible();
  });

  test('should show preview with correct card count', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Upload CSV with 3 cards
    const csvContent = 'Front,Back\nQ1,A1\nQ2,A2\nQ3,A3';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Advance to preview
    await page.click('button:has-text("Next: Map Fields")');
    await page.click('button:has-text("Next: Preview")');

    // Check card count
    const countText = await page.locator('.preview-count').textContent();
    expect(countText).toContain('3');
  });

  test('should navigate back through wizard steps', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Upload and advance to Map Fields
    const csvContent = 'Front,Back\nQ1,A1';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });
    await page.click('button:has-text("Next: Map Fields")');
    await expect(page.locator('.mapping-grid')).toBeVisible();

    // Go back — the Back button is a ghost variant ds-button
    await page.locator('.step-actions button:has-text("Back")').click();
    await expect(page.locator('.config-grid')).toBeVisible();
  });

  test('should show validation error when no Front column is mapped', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Upload CSV — auto-mapping assigns col0=Front, col1=Back
    const csvContent = 'Col1,Col2\nQ1,A1';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    await page.click('button:has-text("Next: Map Fields")');

    // Override auto-mapped Front to (skip) so no Front mapping exists
    const selects = page.locator('.mapping-grid .config-select');
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      await selects.nth(i).selectOption('(skip)');
    }

    // Should show validation error
    await expect(page.locator('.validation-error')).toBeVisible();
  });

  test('should show action buttons on preview step', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');
    await page.click('.mode-btn:has-text("CSV Import")');

    // Upload CSV
    const csvContent = 'Front,Back\nImported Q1,Imported A1\nImported Q2,Imported A2';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('.file-input-hidden').setInputFiles({
      name: 'import-test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Set deck name
    const deckNameInput = page.locator('.config-input[placeholder="My Deck"]');
    await deckNameInput.fill('E2E Test Import');

    // Advance through steps
    await page.click('button:has-text("Next: Map Fields")');
    await page.click('button:has-text("Next: Preview")');

    // Preview step should show action buttons
    await expect(page.locator('button:has-text("Download .apkg")')).toBeVisible();
    await expect(page.locator('button:has-text("Load in App")')).toBeVisible();
    await expect(page.locator('.step-actions button:has-text("Back")')).toBeVisible();

    // Preview table should show the imported data
    const tableText = await page.locator('.preview-table').textContent();
    expect(tableText).toContain('Imported Q1');
    expect(tableText).toContain('Imported A1');
  });
});

test.describe('Manual Deck Creator', () => {
  test('should show manual mode by default', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');

    await expect(page.locator('.deck-creator')).toBeVisible();
    await expect(page.locator('.mode-btn--active:has-text("Manual")')).toBeVisible();
    await expect(page.locator('.input-area')).toBeVisible();
  });

  test('should parse tab-delimited input and show preview', async ({
    loadedDeckPage: page,
  }) => {
    await page.click('.tab:has-text("Create Deck")');

    const textarea = page.locator('.input-area');
    await textarea.fill('Hello\tWorld\nFoo\tBar\nBaz\tQux');

    // Preview should appear
    await expect(page.locator('.preview-section')).toBeVisible();
    await expect(page.locator('.preview-title')).toContainText('3 cards');
  });

  test('should switch delimiter to comma', async ({ loadedDeckPage: page }) => {
    await page.click('.tab:has-text("Create Deck")');

    // Switch to comma delimiter
    await page.locator('.delimiter-select').selectOption('comma');

    const textarea = page.locator('.input-area');
    await textarea.fill('Hello,World\nFoo,Bar');

    // Preview should show 2 cards
    await expect(page.locator('.preview-section')).toBeVisible();
    await expect(page.locator('.preview-title')).toContainText('2 cards');
  });
});
