<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Download, Upload, Archive, Trash2, RotateCcw } from "lucide-vue-next";
import Modal from "../design-system/components/primitives/Modal.vue";
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  <div class="backup-panel">
    <h2 class="backup-title">Collection Backup</h2>
    <p class="backup-description">
      Export and restore your collection as <code>.colpkg</code> files. Backups include
      the full database and all media files.
    </p>

    <!-- Export / Import Actions -->
    <div class="backup-section">
      <h3 class="backup-section-title">Export &amp; Import</h3>
      <div class="backup-actions">
        <button class="backup-btn backup-btn--primary" :disabled="isBusy" @click="handleExport">
          <Download :size="14" />
          Export Collection
        </button>
        <button class="backup-btn backup-btn--secondary" :disabled="isBusy" @click="handleImportClick">
          <Upload :size="14" />
          Import Collection
        </button>
      </div>
    </div>

    <!-- Stored Backups -->
    <div class="backup-section">
      <div class="backup-section-header">
        <h3 class="backup-section-title">Stored Backups</h3>
        <button class="backup-btn backup-btn--primary" :disabled="isBusy" @click="handleCreateBackup">
          <Archive :size="14" />
          Create Backup
        </button>
      </div>

      <div v-if="backups.length === 0" class="backup-empty">
        No backups stored yet.
      </div>

      <div v-else class="backup-list">
        <div v-for="backup in backups" :key="backup.id" class="backup-item">
          <div class="backup-item-info">
            <span class="backup-item-label">{{ backup.label }}</span>
            <span class="backup-item-meta">
              {{ formatDate(backup.createdAt) }} · {{ formatSize(backup.sizeBytes) }}
            </span>
          </div>
          <div class="backup-item-actions">
            <button
              class="backup-icon-btn"
              title="Restore"
              :disabled="isBusy"
              @click="handleRestoreClick(backup.id)"
            >
              <RotateCcw :size="14" />
            </button>
            <button
              class="backup-icon-btn"
              title="Download"
              :disabled="isBusy"
              @click="handleDownload(backup.id)"
            >
              <Download :size="14" />
            </button>
            <button
              class="backup-icon-btn backup-icon-btn--danger"
              title="Delete"
              :disabled="isBusy"
              @click="handleDelete(backup.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Auto-Backup Settings -->
    <details class="backup-settings">
      <summary>Auto-Backup Settings</summary>
      <div class="backup-settings-content">
        <label class="backup-toggle">
          <input
            type="checkbox"
            v-model="settings.autoBackupEnabled"
            @change="updateSettings"
          />
          Enable periodic auto-backup
        </label>

        <label class="backup-toggle">
          <input
            type="checkbox"
            v-model="settings.backupBeforeSync"
            @change="updateSettings"
          />
          Backup before sync
        </label>

        <div class="backup-field">
          <label class="backup-field-label">Backup interval</label>
          <select
            class="backup-select"
            v-model.number="settings.periodicIntervalMs"
            @change="updateSettings"
          >
            <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="backup-field">
          <label class="backup-field-label">Max stored backups</label>
          <input
            type="number"
            class="backup-input backup-input--narrow"
            v-model.number="settings.maxBackupCount"
            min="1"
            max="20"
            @change="updateSettings"
          />
        </div>

        <div v-if="settings.lastAutoBackupTime" class="backup-last-auto">
          Last auto-backup: {{ formatDate(settings.lastAutoBackupTime) }}
        </div>
      </div>
    </details>

    <!-- Status Messages -->
    <div v-if="status" class="backup-status">{{ status }}</div>
    <div v-if="error" class="backup-error">{{ error }}</div>

    <!-- Restore Confirmation Modal -->
    <Modal
      :is-open="showRestoreConfirm"
      title="Restore Backup"
      size="sm"
      @close="showRestoreConfirm = false"
    >
      <p class="backup-confirm-text">
        This will <strong>replace your current collection</strong> with the backup.
        Any unsaved changes will be lost.
      </p>
      <div class="backup-confirm-actions">
        <button class="backup-btn backup-btn--danger" @click="confirmRestore">
          Restore
        </button>
        <button class="backup-btn backup-btn--secondary" @click="showRestoreConfirm = false">
          Cancel
        </button>
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
        This will <strong>replace your current collection</strong> with the imported file.
        Any unsaved changes will be lost.
      </p>
      <div class="backup-confirm-actions">
        <button class="backup-btn backup-btn--danger" @click="confirmImport">
          Import
        </button>
        <button class="backup-btn backup-btn--secondary" @click="showImportConfirm = false">
          Cancel
        </button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.backup-panel {
  max-width: 540px;
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4);
  text-align: left;
}

.backup-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-2) 0;
}

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

.backup-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1-5);
  padding: var(--spacing-2) var(--spacing-4);
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.backup-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.backup-btn--primary {
  color: white;
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.backup-btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.backup-btn--secondary {
  color: var(--color-text-primary);
  background: var(--color-surface);
}

.backup-btn--secondary:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.backup-btn--danger {
  color: #ef4444;
  background: var(--color-surface);
  border-color: #ef4444;
}

.backup-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 10%, var(--color-surface));
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

.backup-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.backup-icon-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.backup-icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.backup-icon-btn--danger:hover:not(:disabled) {
  color: #ef4444;
  border-color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, var(--color-surface));
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

.backup-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
}

.backup-toggle input[type="checkbox"] {
  accent-color: var(--color-primary);
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

.backup-select,
.backup-input {
  padding: var(--spacing-1-5) var(--spacing-2);
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
}

.backup-select:focus,
.backup-input:focus {
  border-color: var(--color-primary);
}

.backup-input--narrow {
  max-width: 80px;
}

.backup-last-auto {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.backup-status {
  margin-top: var(--spacing-4);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border-radius: var(--radius-md);
}

.backup-error {
  margin-top: var(--spacing-4);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, var(--color-surface));
  border-radius: var(--radius-md);
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
