import { test, expect } from './fixtures';

/**
 * Tests for the CSV Import Wizard accessed via Create Deck tab.
 */

test.describe('CSV Import Wizard', () => {
  test('should navigate to Create Deck tab and show mode toggle', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();

    await expect(page.getByRole('heading', { name: 'Create Deck' })).toBeVisible();

    // Mode toggle should be visible
    await expect(page.getByRole('button', { name: 'Manual' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CSV Import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Generate' })).toBeVisible();
  });

  test('should switch to CSV Import mode and show wizard', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // CSV wizard should appear
    await expect(page.getByTestId('csv-wizard')).toBeVisible();

    // Should be on step 1 (Upload)
    await expect(page.locator('.step-indicator--active .step-label:has-text("Upload")')).toBeVisible();
    await expect(page.locator('.drop-zone')).toBeVisible();
    await expect(page.locator('.drop-text')).toHaveText('Drop a CSV or TSV file here');
  });

  test('should upload a CSV file and advance to Configure step', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Create a simple CSV file and upload it via the hidden file input
    const csvContent = 'Front,Back\nWhat is 2+2?,4\nWhat is 3+3?,6\nCapital of France?,Paris';
    const buffer = Buffer.from(csvContent, 'utf-8');

    const fileInput = page.locator('input[type="file"]');
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
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Upload CSV
    const csvContent = 'Front,Back\nQ1,A1\nQ2,A2';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Should show config options
    await expect(page.getByTestId('config-grid')).toBeVisible();

    // Delimiter dropdown
    const delimiterSelect = page.locator('select').first();
    await expect(delimiterSelect).toBeVisible();

    // Header checkbox
    await expect(page.getByText('First row is a header')).toBeVisible();

    // Deck name input
    const deckNameInput = page.getByPlaceholder('My Deck');
    await expect(deckNameInput).toBeVisible();

    // Quick preview should be visible
    await expect(page.getByTestId('quick-preview')).toBeVisible();
  });

  test('should advance through all wizard steps', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Step 1: Upload
    const csvContent = 'Front,Back\nWhat is 2+2?,4\nWhat is 3+3?,6';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Step 2: Configure - click Next
    await expect(page.locator('.step-indicator--active .step-label:has-text("Configure")')).toBeVisible();
    await page.getByRole('button', { name: 'Next: Map Fields' }).click();

    // Step 3: Map Fields
    await expect(page.locator('.step-indicator--active .step-label:has-text("Map Fields")')).toBeVisible();
    await expect(page.getByTestId('mapping-grid')).toBeVisible();

    // Should show column mapping dropdowns
    const mappingSelects = page.getByTestId('mapping-grid').locator('select');
    const selectCount = await mappingSelects.count();
    expect(selectCount).toBeGreaterThan(0);

    // Click Next to Preview
    await page.getByRole('button', { name: 'Next: Preview' }).click();

    // Step 4: Preview
    await expect(page.locator('.step-indicator--active .step-label:has-text("Preview")')).toBeVisible();
    await expect(page.getByTestId('preview-table')).toBeVisible();
  });

  test('should show preview with correct card count', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Upload CSV with 3 cards
    const csvContent = 'Front,Back\nQ1,A1\nQ2,A2\nQ3,A3';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Advance to preview
    await page.getByRole('button', { name: 'Next: Map Fields' }).click();
    await page.getByRole('button', { name: 'Next: Preview' }).click();

    // Check card count — the text is "N cards" so match exactly "3 cards"
    const countText = await page.getByTestId('preview-count').textContent();
    expect(countText).toMatch(/\b3\b/);
  });

  test('should navigate back through wizard steps', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Upload and advance to Map Fields
    const csvContent = 'Front,Back\nQ1,A1';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });
    await page.getByRole('button', { name: 'Next: Map Fields' }).click();
    await expect(page.getByTestId('mapping-grid')).toBeVisible();

    // Go back — the Back button is a ghost variant ds-button
    await page.getByTestId('csv-wizard').getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('config-grid')).toBeVisible();
  });

  test('should show validation error when no Front column is mapped', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Upload CSV — auto-mapping assigns col0=Front, col1=Back
    const csvContent = 'Col1,Col2\nQ1,A1';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    await page.getByRole('button', { name: 'Next: Map Fields' }).click();

    // Override auto-mapped Front to (skip) so no Front mapping exists
    const selects = page.getByTestId('mapping-grid').locator('select');
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      await selects.nth(i).selectOption('(skip)');
    }

    // Should show validation error
    await expect(page.getByTestId('validation-error')).toBeVisible();
  });

  test('should show action buttons on preview step', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();
    await page.getByRole('button', { name: 'CSV Import' }).click();

    // Upload CSV
    const csvContent = 'Front,Back\nImported Q1,Imported A1\nImported Q2,Imported A2';
    const buffer = Buffer.from(csvContent, 'utf-8');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'import-test.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Set deck name
    const deckNameInput = page.getByPlaceholder('My Deck');
    await deckNameInput.fill('E2E Test Import');

    // Advance through steps
    await page.getByRole('button', { name: 'Next: Map Fields' }).click();
    await page.getByRole('button', { name: 'Next: Preview' }).click();

    // Preview step should show action buttons
    await expect(page.getByRole('button', { name: 'Download .apkg' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load in App' })).toBeVisible();
    await expect(page.getByTestId('csv-wizard').getByRole('button', { name: 'Back' })).toBeVisible();

    // Preview table should show the imported data
    const tableText = await page.getByTestId('preview-table').textContent();
    expect(tableText).toContain('Imported Q1');
    expect(tableText).toContain('Imported A1');
  });
});

test.describe('Manual Deck Creator', () => {
  test('should show manual mode by default', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();

    await expect(page.getByRole('heading', { name: 'Create Deck' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manual' })).toBeVisible();
    await expect(page.getByPlaceholder(/paste your table/i)).toBeVisible();
  });

  test('should parse tab-delimited input and show preview', async ({
    loadedDeckPage: page,
  }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();

    const textarea = page.getByPlaceholder(/paste your table/i);
    await textarea.fill('Hello\tWorld\nFoo\tBar\nBaz\tQux');

    // Preview should appear
    await expect(page.getByTestId('preview-section')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Preview/ })).toContainText('3 cards');
  });

  test('should switch delimiter to comma', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Create Deck' }).click();

    // Switch to comma delimiter
    await page.getByLabel(/delimiter/i).selectOption('comma');

    const textarea = page.getByPlaceholder(/paste your table/i);
    await textarea.fill('Hello,World\nFoo,Bar');

    // Preview should show 2 cards
    await expect(page.getByTestId('preview-section')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Preview/ })).toContainText('2 cards');
  });
});
