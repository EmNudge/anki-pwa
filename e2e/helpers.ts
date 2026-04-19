import type { Page, Locator } from '@playwright/test';

// ─── Locators: Navigation ────────────────────────────────────────────

export function tab(page: Page, name: string): Locator {
  return page.getByRole('tab', { name });
}

export function activeTab(page: Page): Locator {
  return page.locator('[role="tab"][aria-selected="true"]');
}

// ─── Locators: Browse view ───────────────────────────────────────────

export function browseTable(page: Page): Locator {
  return page.getByTestId('browse-table');
}

export function browseRows(page: Page): Locator {
  return browseTable(page).locator('tbody tr');
}

export function detailPane(page: Page): Locator {
  return page.getByTestId('detail-pane');
}

export function detailFieldValues(page: Page): Locator {
  return page.getByTestId('detail-field-value');
}

export function detailTags(page: Page): Locator {
  return page.getByTestId('detail-tags');
}

// ─── Locators: Card review ──────────────────────────────────────────

export function flashCard(page: Page): Locator {
  return page.getByTestId('flash-card');
}

export function cardContent(page: Page): Locator {
  return page.frameLocator('.card-content iframe.sandboxed-card').locator('body');
}

export function answerButton(page: Page, answer: string): Locator {
  return page.getByRole('button', { name: new RegExp(answer) });
}

export function revealButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reveal' });
}

// ─── Locators: Command palette ──────────────────────────────────────

export function commandPalette(page: Page): Locator {
  return page.locator('.command-palette');
}

export function commandPaletteInput(page: Page): Locator {
  return page.locator('.command-palette-input');
}

export function commandPaletteItems(page: Page): Locator {
  return page.getByTestId('command-palette-item');
}

// ─── Locators: Edit modal ───────────────────────────────────────────

export function editForm(page: Page): Locator {
  return page.locator('.edit-form');
}

export function editFormEditors(page: Page): Locator {
  return page.locator('.edit-form .tiptap');
}

export function tagBadges(page: Page): Locator {
  return page.locator('.edit-form .tag-badge');
}

export function tagInput(page: Page): Locator {
  return page.locator('.tag-add').getByRole('textbox');
}

// ─── Locators: Stats ────────────────────────────────────────────────

export function statsPanel(page: Page): Locator {
  return page.getByTestId('stats-panel');
}

export function periodSelector(page: Page): Locator {
  return page.getByTestId('period-selector');
}

export function chartGrids(page: Page): Locator {
  return page.getByTestId('chart-grid');
}

// ─── Locators: Congrats ─────────────────────────────────────────────

export function congratsScreen(page: Page): Locator {
  return page.getByTestId('congrats-screen');
}

// ─── Actions: Navigation ────────────────────────────────────────────

export async function navigateTo(page: Page, tabName: string): Promise<void> {
  await tab(page, tabName).click();
}

// ─── Actions: Review flow ───────────────────────────────────────────

export async function revealAndAnswer(
  page: Page,
  answer: 'Again' | 'Hard' | 'Good' | 'Easy',
): Promise<void> {
  await revealButton(page).click();
  await answerButton(page, answer).click();
}

export async function reviewCards(
  page: Page,
  count: number,
  answer: 'Again' | 'Hard' | 'Good' | 'Easy' = 'Good',
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await revealAndAnswer(page, answer);
    await page.waitForTimeout(300);
  }
}

// ─── Actions: Browse and select ─────────────────────────────────────

export async function selectBrowseRow(page: Page, index: number): Promise<void> {
  await browseRows(page).nth(index).click();
}

export async function selectFirstBrowseRow(page: Page): Promise<void> {
  await browseRows(page).first().click();
}

// ─── Actions: Edit note ─────────────────────────────────────────────

export async function openEditModal(page: Page): Promise<void> {
  await detailPane(page).getByRole('button', { name: 'Edit' }).click();
}

export async function editNoteField(
  page: Page,
  fieldIndex: number,
  newValue: string,
): Promise<void> {
  const editor = editFormEditors(page).nth(fieldIndex);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(newValue);
}

export async function saveEditModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
}

// ─── Actions: Tags ──────────────────────────────────────────────────

export async function addTag(page: Page, tagName: string): Promise<void> {
  await tagInput(page).fill(tagName);
  await page.getByRole('button', { name: 'Add' }).click();
}

export async function removeTag(page: Page, tagName: string): Promise<void> {
  const badge = page.locator(`.edit-form .tag-badge:has-text("${tagName}")`);
  await badge.getByRole('button', { name: /remove tag/i }).click();
}

// ─── Actions: Command palette ───────────────────────────────────────

export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await commandPalette(page).waitFor();
}

export async function executeCommand(page: Page, searchTerm: string): Promise<void> {
  await openCommandPalette(page);
  await commandPaletteInput(page).fill(searchTerm);
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
}

// ─── Actions: Scheduler settings ────────────────────────────────────

export async function openSchedulerSettings(page: Page): Promise<void> {
  await executeCommand(page, 'scheduler settings');
}
