import { test, expect } from './fixtures';

test.describe('Note Editing', () => {
  test('should show Edit button when a card is selected in browse tab', async ({ loadedDeckPage: page }) => {
    // Navigate to Browse tab
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.getByTestId('browse-table')).toBeVisible();

    // Click the first row in the table
    await page.getByTestId('browse-table').locator('tbody tr').first().click();

    // Edit button should appear in the detail pane
    const editButton = page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' });
    await expect(editButton).toBeVisible();
  });

  test('should not show Edit button when no card is selected', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page.getByTestId('browse-table')).toBeVisible();

    // No row selected — detail pane should show empty message
    await expect(page.getByText(/no card selected/i)).toBeVisible();
    await expect(page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' })).not.toBeVisible();
  });

  test('should open edit modal with field values when Edit is clicked', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();

    // Read the field labels and values from the detail pane before editing
    const fieldLabels = await page.locator('.detail-field-label').allTextContents();
    expect(fieldLabels.length).toBeGreaterThan(0);

    // Click Edit
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    // Modal should be visible
    await expect(page.getByRole('heading', { name: 'Edit Note' })).toBeVisible();

    // Modal should have textarea fields matching the field labels
    const modalLabels = await page.locator('.edit-form .field-label').allTextContents();
    // Filter to field labels only (exclude "Tags" label)
    const fieldOnlyLabels = modalLabels.filter(l => l !== 'Tags');
    expect(fieldOnlyLabels).toEqual(fieldLabels);

    // Tiptap editors should be present
    const editors = page.locator('.edit-form .tiptap');
    const count = await editors.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should close edit modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Note' })).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should be closed
    await expect(page.getByRole('heading', { name: 'Edit Note' })).not.toBeVisible();
  });

  test('should close edit modal on Escape', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Note' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { name: 'Edit Note' })).not.toBeVisible();
  });

  test('should update field value in detail pane after saving', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();

    // Read the original first field value
    const originalValue = await page.getByTestId('detail-field-value').first().textContent();

    // Open edit modal
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Note' })).toBeVisible();

    // Modify the first field via Tiptap editor
    const firstEditor = page.locator('.edit-form .tiptap').first();
    await firstEditor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited field value e2e test');
    const newValue = 'Edited field value e2e test';

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Modal should close
    await expect(page.getByRole('heading', { name: 'Edit Note' })).not.toBeVisible();

    // Detail pane should now show the updated value
    const updatedValue = await page.getByTestId('detail-field-value').first().textContent();
    expect(updatedValue).toContain(newValue);
    expect(updatedValue).not.toBe(originalValue);
  });

  test('should update the table sort field after editing', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();

    // Get original first row text
    const firstRowFirstCell = page.getByTestId('browse-table').locator('tbody tr').first().locator('td').first();
    const originalCellText = await firstRowFirstCell.textContent();

    // Select the first row
    await page.getByTestId('browse-table').locator('tbody tr').first().click();

    // Open edit modal and change first field via Tiptap editor
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();
    const firstEditor = page.locator('.edit-form .tiptap').first();
    await firstEditor.click();
    await page.keyboard.press('Control+A');
    const newValue = 'Updated sort field';
    await page.keyboard.type(newValue);
    await page.getByRole('button', { name: 'Save' }).click();

    // Table sort field column should reflect the change
    const updatedCellText = await firstRowFirstCell.textContent();
    expect(updatedCellText).not.toBe(originalCellText);
  });

  test('should add a tag via the edit modal', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();

    // Open edit modal
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    // Add a new tag
    const tagInput = page.locator('.tag-add').getByRole('textbox');
    await tagInput.fill('new-test-tag');
    await page.getByRole('button', { name: 'Add' }).click();

    // Tag should appear in the modal's tag list
    await expect(page.locator('.edit-form .tag-badge:has-text("new-test-tag")')).toBeVisible();

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Tag should now appear in the detail pane
    await expect(page.getByTestId('detail-tags').locator('.tag-badge:has-text("new-test-tag")')).toBeVisible();
  });

  test('should remove a tag via the edit modal', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();

    // First, add a tag so we have one to remove
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    const tagInput = page.locator('.tag-add').getByRole('textbox');
    await tagInput.fill('tag-to-remove');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.edit-form .tag-badge:has-text("tag-to-remove")')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify tag is in detail pane
    await expect(page.getByTestId('detail-tags').locator('.tag-badge:has-text("tag-to-remove")')).toBeVisible();

    // Re-open edit modal and remove the tag
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();
    const tagBadge = page.locator('.edit-form .tag-badge:has-text("tag-to-remove")');
    await tagBadge.getByRole('button', { name: /remove tag/i }).click();

    // Tag should be gone from the modal
    await expect(page.locator('.edit-form .tag-badge:has-text("tag-to-remove")')).not.toBeVisible();

    // Save and verify tag is gone from detail pane
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('detail-tags').locator('.tag-badge:has-text("tag-to-remove")')).not.toBeVisible();
  });

  test('should add a tag by pressing Enter', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();

    const tagInput = page.locator('.tag-add').getByRole('textbox');
    await tagInput.fill('enter-tag');
    await tagInput.press('Enter');

    await expect(page.locator('.edit-form .tag-badge:has-text("enter-tag")')).toBeVisible();
  });

  test('should preserve edits across cards sharing the same note', async ({ loadedDeckPage: page }) => {
    await page.getByRole('tab', { name: 'Browse' }).click();

    // Switch to Cards view mode to see individual cards (notes may generate multiple cards)
    await page.getByRole('button', { name: 'Cards' }).click();
    await page.waitForTimeout(300);

    // Get the first row guid by selecting it and reading a field value
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    // Edit the first card's note
    await page.getByTestId('detail-pane').getByRole('button', { name: 'Edit' }).click();
    const firstEditor = page.locator('.edit-form .tiptap').first();
    await firstEditor.click();
    await page.keyboard.press('Control+A');
    const uniqueValue = `shared-note-edit-${Date.now()}`;
    await page.keyboard.type(uniqueValue);
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify the edit took effect
    const updatedValue = await page.getByTestId('detail-field-value').first().textContent();
    expect(updatedValue).toContain(uniqueValue);

    // Switch to Notes mode and verify the edit is visible there too
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.waitForTimeout(300);
    await page.getByTestId('browse-table').locator('tbody tr').first().click();
    const noteFieldValue = await page.getByTestId('detail-field-value').first().textContent();
    expect(noteFieldValue).toContain(uniqueValue);
  });
});
