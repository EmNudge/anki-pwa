<script setup lang="ts">
import { ref, onMounted } from "vue";
import { formatFileSize } from "../utils/format";
import { Download, Upload, Archive, Trash2, RotateCcw } from "lucide-vue-next";
import { Alert, Button, Checkbox, Modal, Page, Select, TextInput } from "../design-system";
import {
  exportToFile,
  importFromFile,
  createBackup,
  restoreFromBackup,
  listBackups,
  deleteStoredBackup,
  downloadStoredBackup,
  getBackupSettings,
  saveBackupSettings,
  type BackupSettings,
} from "../backup/backupService";
import type { BackupMeta } from "../backup/db";

const backups = ref<BackupMeta[]>([]);
const status = ref("");
const error = ref("");
const isBusy = ref(false);
const settings = ref<BackupSettings>(getBackupSettings());

// Confirmation modals
const showRestoreConfirm = ref(false);
const restoreTargetId = ref<string | null>(null);
const showImportConfirm = ref(false);
const pendingImportFile = ref<Blob | null>(null);

onMounted(async () => {
  await refreshBackupList();
});

async function refreshBackupList() {
  try {
    backups.value = await listBackups();
  } catch (err) {
    console.warn("Failed to list backups:", err);
  }
}

async function handleExport() {
  isBusy.value = true;
  error.value = "";
  status.value = "Creating collection export...";
  try {
    await exportToFile();
    status.value = "Collection exported successfully.";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Export failed";
    status.value = "";
  } finally {
    isBusy.value = false;
  }
}

function handleImportClick() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".colpkg,.apkg";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      pendingImportFile.value = file;
      showImportConfirm.value = true;
    }
  };
  input.click();
}

async function confirmImport() {
  const file = pendingImportFile.value;
  showImportConfirm.value = false;
  pendingImportFile.value = null;
  if (!file) return;

  isBusy.value = true;
  error.value = "";
  status.value = "Restoring from file...";
  try {
    await importFromFile(file);
    status.value = "Collection restored successfully.";
    await refreshBackupList();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Import failed";
    status.value = "";
  } finally {
    isBusy.value = false;
  }
}

async function handleCreateBackup() {
  isBusy.value = true;
  error.value = "";
  status.value = "Creating backup...";
  try {
    await createBackup("Manual");
    status.value = "Backup created successfully.";
    await refreshBackupList();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Backup failed";
    status.value = "";
  } finally {
    isBusy.value = false;
  }
}

function handleRestoreClick(id: string) {
  restoreTargetId.value = id;
  showRestoreConfirm.value = true;
}

async function confirmRestore() {
  const id = restoreTargetId.value;
  showRestoreConfirm.value = false;
  restoreTargetId.value = null;
  if (!id) return;

  isBusy.value = true;
  error.value = "";
  status.value = "Restoring backup...";
  try {
    await restoreFromBackup(id);
    status.value = "Backup restored successfully.";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Restore failed";
    status.value = "";
  } finally {
    isBusy.value = false;
  }
}

async function handleDownload(id: string) {
  isBusy.value = true;
  error.value = "";
  try {
    await downloadStoredBackup(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Download failed";
  } finally {
    isBusy.value = false;
  }
}

async function handleDelete(id: string) {
  try {
    await deleteStoredBackup(id);
    await refreshBackupList();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Delete failed";
  }
}

function updateSettings() {
  saveBackupSettings(settings.value);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

const intervalOptions = [
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "6 hours", value: 6 * 60 * 60 * 1000 },
  { label: "12 hours", value: 12 * 60 * 60 * 1000 },
  { label: "24 hours", value: 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
];
</script>

<template>
  <Page title="Collection Backup">
    <p class="backup-description">
      Export and restore your collection as <code>.colpkg</code> files. Backups include the full
      database and all media files.
    </p>

    <!-- Export / Import Actions -->
    <div class="backup-section" data-testid="backup-section">
      <h3 class="backup-section-title">Export &amp; Import</h3>
      <div class="backup-actions">
        <Button size="sm" :disabled="isBusy" @click="handleExport">
          <template #iconLeft><Download :size="14" /></template>
          Export Collection
        </Button>
        <Button variant="secondary" size="sm" :disabled="isBusy" @click="handleImportClick">
          <template #iconLeft><Upload :size="14" /></template>
          Import Collection
        </Button>
      </div>
    </div>

    <!-- Stored Backups -->
    <div class="backup-section" data-testid="backup-section">
      <div class="backup-section-header">
        <h3 class="backup-section-title">Stored Backups</h3>
        <Button size="sm" :disabled="isBusy" @click="handleCreateBackup">
          <template #iconLeft><Archive :size="14" /></template>
          Create Backup
        </Button>
      </div>

      <div v-if="backups.length === 0" class="backup-empty">No backups stored yet.</div>

      <div v-else class="backup-list">
        <div v-for="backup in backups" :key="backup.id" class="backup-item">
          <div class="backup-item-info">
            <span class="backup-item-label">{{ backup.label }}</span>
            <span class="backup-item-meta">
              {{ formatDate(backup.createdAt) }} · {{ formatFileSize(backup.sizeBytes) }}
            </span>
          </div>
          <div class="backup-item-actions">
            <Button
              variant="secondary"
              size="sm"
              square
              title="Restore"
              :disabled="isBusy"
              @click="handleRestoreClick(backup.id)"
            >
              <RotateCcw :size="14" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              square
              title="Download"
              :disabled="isBusy"
              @click="handleDownload(backup.id)"
            >
              <Download :size="14" />
            </Button>
            <Button
              variant="danger-outline"
              size="sm"
              square
              title="Delete"
              :disabled="isBusy"
              @click="handleDelete(backup.id)"
            >
              <Trash2 :size="14" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Auto-Backup Settings -->
    <details class="backup-settings">
      <summary>Auto-Backup Settings</summary>
      <div class="backup-settings-content">
        <Checkbox
          :model-value="settings.autoBackupEnabled"
          label="Enable periodic auto-backup"
          size="sm"
          @update:model-value="
            settings.autoBackupEnabled = $event;
            updateSettings();
          "
        />

        <Checkbox
          :model-value="settings.backupBeforeSync"
          label="Backup before sync"
          size="sm"
          @update:model-value="
            settings.backupBeforeSync = $event;
            updateSettings();
          "
        />

        <div class="backup-field">
          <label class="backup-field-label">Backup interval</label>
          <Select
            :model-value="String(settings.periodicIntervalMs)"
            size="sm"
            :full-width="false"
            @update:model-value="
              settings.periodicIntervalMs = Number($event);
              updateSettings();
            "
          >
            <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </Select>
        </div>

        <div class="backup-field">
          <label class="backup-field-label">Max stored backups</label>
          <TextInput
            :model-value="settings.maxBackupCount"
            type="number"
            size="sm"
            :full-width="false"
            min="1"
            max="20"
            style="max-width: 80px"
            @update:model-value="
              settings.maxBackupCount = Number($event);
              updateSettings();
            "
          />
        </div>

        <div v-if="settings.lastAutoBackupTime" class="backup-last-auto">
          Last auto-backup: {{ formatDate(settings.lastAutoBackupTime) }}
        </div>
      </div>
    </details>

    <!-- Status Messages -->
    <Alert v-if="status" variant="info" class="backup-alert">{{ status }}</Alert>
    <Alert v-if="error" variant="error" class="backup-alert">{{ error }}</Alert>

    <!-- Restore Confirmation Modal -->
    <Modal
      :is-open="showRestoreConfirm"
      title="Restore Backup"
      size="sm"
      @close="showRestoreConfirm = false"
    >
      <p class="backup-confirm-text">
        This will <strong>replace your current collection</strong> with the backup. Any unsaved
        changes will be lost.
      </p>
      <div class="backup-confirm-actions">
        <Button variant="danger" size="sm" @click="confirmRestore">Restore</Button>
        <Button variant="secondary" size="sm" @click="showRestoreConfirm = false">Cancel</Button>
      </div>
    </Modal>

    <!-- Import Confirmation Modal -->
    <Modal
      :is-open="showImportConfirm"
      title="Import Collection"
      size="sm"
      @close="showImportConfirm = false"
    >
      <p class="backup-confirm-text">
        This will <strong>replace your current collection</strong> with the imported file. Any
        unsaved changes will be lost.
      </p>
      <div class="backup-confirm-actions">
        <Button variant="danger" size="sm" @click="confirmImport">Import</Button>
        <Button variant="secondary" size="sm" @click="showImportConfirm = false">Cancel</Button>
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
.backup-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0 0 var(--spacing-6) 0;
  line-height: 1.5;
}

.backup-description code {
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
}

.backup-section {
  margin-bottom: var(--spacing-6);
}

.backup-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-3);
}

.backup-section-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-3) 0;
}

.backup-section-header .backup-section-title {
  margin-bottom: 0;
}

.backup-actions {
  display: flex;
  gap: var(--spacing-2);
  flex-wrap: wrap;
}

.backup-empty {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  padding: var(--spacing-4) 0;
}

.backup-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-3);
  padding: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.backup-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.backup-item-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.backup-item-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.backup-item-actions {
  display: flex;
  gap: var(--spacing-1);
  flex-shrink: 0;
}

.backup-settings {
  margin-top: var(--spacing-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.backup-settings summary {
  cursor: pointer;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.backup-settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  padding-top: var(--spacing-3);
}

.backup-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.backup-field-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.backup-last-auto {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.backup-alert {
  margin-top: var(--spacing-4);
}

.backup-confirm-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-4) 0;
  line-height: 1.5;
}

.backup-confirm-actions {
  display: flex;
  gap: var(--spacing-2);
}
</style>
