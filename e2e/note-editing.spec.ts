import { test, expect } from './fixtures';

test.describe('Note Editing', () => {
  test('should show Edit button when a card is selected in browse tab', async ({ loadedDeckPage: page }) => {
    // Navigate to Browse tab
    await page.click('button:has-text("Browse")');
    await expect(page.locator('.browse-table')).toBeVisible();

    // Click the first row in the table
    await page.locator('.browse-table tbody tr').first().click();

    // Edit button should appear in the detail pane
    const editButton = page.locator('.detail-pane button:has-text("Edit")');
    await expect(editButton).toBeVisible();
  });

  test('should not show Edit button when no card is selected', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await expect(page.locator('.browse-table')).toBeVisible();

    // No row selected — detail pane should show empty message
    await expect(page.locator('.detail-empty')).toBeVisible();
    await expect(page.locator('.detail-pane button:has-text("Edit")')).not.toBeVisible();
  });

  test('should open edit modal with field values when Edit is clicked', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();

    // Read the field labels and values from the detail pane before editing
    const fieldLabels = await page.locator('.detail-field-label').allTextContents();
    expect(fieldLabels.length).toBeGreaterThan(0);

    // Click Edit
    await page.locator('.detail-pane button:has-text("Edit")').click();

    // Modal should be visible
    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).toBeVisible();

    // Modal should have textarea fields matching the field labels
    const modalLabels = await page.locator('.edit-form .field-label').allTextContents();
    // Filter to field labels only (exclude "Tags" label)
    const fieldOnlyLabels = modalLabels.filter(l => l !== 'Tags');
    expect(fieldOnlyLabels).toEqual(fieldLabels);

    // Textareas should have content
    const textareas = page.locator('.edit-form textarea.field-input');
    const count = await textareas.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should close edit modal on Cancel', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();
    await page.locator('.detail-pane button:has-text("Edit")').click();

    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).toBeVisible();

    // Click Cancel
    await page.locator('.ds-modal button:has-text("Cancel")').click();

    // Modal should be closed
    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).not.toBeVisible();
  });

  test('should close edit modal on Escape', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();
    await page.locator('.detail-pane button:has-text("Edit")').click();

    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).not.toBeVisible();
  });

  test('should update field value in detail pane after saving', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();

    // Read the original first field value
    const originalValue = await page.locator('.detail-field-value').first().textContent();

    // Open edit modal
    await page.locator('.detail-pane button:has-text("Edit")').click();
    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).toBeVisible();

    // Modify the first field
    const firstTextarea = page.locator('.edit-form textarea.field-input').first();
    await firstTextarea.clear();
    const newValue = 'Edited field value e2e test';
    await firstTextarea.fill(newValue);

    // Save
    await page.locator('.ds-modal button:has-text("Save")').click();

    // Modal should close
    await expect(page.locator('.ds-modal__title:has-text("Edit Note")')).not.toBeVisible();

    // Detail pane should now show the updated value
    const updatedValue = await page.locator('.detail-field-value').first().textContent();
    expect(updatedValue).toContain(newValue);
    expect(updatedValue).not.toBe(originalValue);
  });

  test('should update the table sort field after editing', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');

    // Get original first row text
    const firstRowFirstCell = page.locator('.browse-table tbody tr').first().locator('td').first();
    const originalCellText = await firstRowFirstCell.textContent();

    // Select the first row
    await page.locator('.browse-table tbody tr').first().click();

    // Open edit modal and change first field
    await page.locator('.detail-pane button:has-text("Edit")').click();
    const firstTextarea = page.locator('.edit-form textarea.field-input').first();
    await firstTextarea.clear();
    const newValue = 'Updated sort field';
    await firstTextarea.fill(newValue);
    await page.locator('.ds-modal button:has-text("Save")').click();

    // Table sort field column should reflect the change
    const updatedCellText = await firstRowFirstCell.textContent();
    expect(updatedCellText).not.toBe(originalCellText);
  });

  test('should add a tag via the edit modal', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();

    // Open edit modal
    await page.locator('.detail-pane button:has-text("Edit")').click();

    // Add a new tag
    const tagInput = page.locator('.tag-input');
    await tagInput.fill('new-test-tag');
    await page.locator('.ds-modal button:has-text("Add")').click();

    // Tag should appear in the modal's tag list
    await expect(page.locator('.edit-form .tag-badge:has-text("new-test-tag")')).toBeVisible();

    // Save
    await page.locator('.ds-modal button:has-text("Save")').click();

    // Tag should now appear in the detail pane
    await expect(page.locator('.detail-tags .tag-badge:has-text("new-test-tag")')).toBeVisible();
  });

  test('should remove a tag via the edit modal', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');

    // First, add a tag so we have one to remove
    await page.locator('.browse-table tbody tr').first().click();
    await page.locator('.detail-pane button:has-text("Edit")').click();

    const tagInput = page.locator('.tag-input');
    await tagInput.fill('tag-to-remove');
    await page.locator('.ds-modal button:has-text("Add")').click();
    await expect(page.locator('.edit-form .tag-badge:has-text("tag-to-remove")')).toBeVisible();
    await page.locator('.ds-modal button:has-text("Save")').click();

    // Verify tag is in detail pane
    await expect(page.locator('.detail-tags .tag-badge:has-text("tag-to-remove")')).toBeVisible();

    // Re-open edit modal and remove the tag
    await page.locator('.detail-pane button:has-text("Edit")').click();
    const tagBadge = page.locator('.edit-form .tag-badge:has-text("tag-to-remove")');
    await tagBadge.locator('.tag-remove').click();

    // Tag should be gone from the modal
    await expect(page.locator('.edit-form .tag-badge:has-text("tag-to-remove")')).not.toBeVisible();

    // Save and verify tag is gone from detail pane
    await page.locator('.ds-modal button:has-text("Save")').click();
    await expect(page.locator('.detail-tags .tag-badge:has-text("tag-to-remove")')).not.toBeVisible();
  });

  test('should add a tag by pressing Enter', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');
    await page.locator('.browse-table tbody tr').first().click();
    await page.locator('.detail-pane button:has-text("Edit")').click();

    const tagInput = page.locator('.tag-input');
    await tagInput.fill('enter-tag');
    await tagInput.press('Enter');

    await expect(page.locator('.edit-form .tag-badge:has-text("enter-tag")')).toBeVisible();
  });

  test('should preserve edits across cards sharing the same note', async ({ loadedDeckPage: page }) => {
    await page.click('button:has-text("Browse")');

    // Switch to Cards view mode to see individual cards (notes may generate multiple cards)
    await page.locator('button.toggle-btn:has-text("Cards")').click();
    await page.waitForTimeout(300);

    // Get the first row guid by selecting it and reading a field value
    await page.locator('.browse-table tbody tr').first().click();
    const firstFieldValue = await page.locator('.detail-field-value').first().textContent();

    // Edit the first card's note
    await page.locator('.detail-pane button:has-text("Edit")').click();
    const firstTextarea = page.locator('.edit-form textarea.field-input').first();
    await firstTextarea.clear();
    const uniqueValue = `shared-note-edit-${Date.now()}`;
    await firstTextarea.fill(uniqueValue);
    await page.locator('.ds-modal button:has-text("Save")').click();

    // Verify the edit took effect
    const updatedValue = await page.locator('.detail-field-value').first().textContent();
    expect(updatedValue).toContain(uniqueValue);

    // Switch to Notes mode and verify the edit is visible there too
    await page.locator('button.toggle-btn:has-text("Notes")').click();
    await page.waitForTimeout(300);
    await page.locator('.browse-table tbody tr').first().click();
    const noteFieldValue = await page.locator('.detail-field-value').first().textContent();
    expect(noteFieldValue).toContain(uniqueValue);
  });
});
