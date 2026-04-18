<script setup lang="ts">
import { ref, watch, computed } from "vue";
import ImageOcclusionEditor from "./ImageOcclusionEditor.vue";
import TiptapEditor from "./TiptapEditor.vue";
import { Button } from "../design-system";
import type { AnkiDB2Data } from "../ankiParser/anki2";
import {
  IO_FIELD_NAMES,
  getImageFilename,
  parseOcclusionShapesForEditor,
  serializeShapesToSvg,
  extractOcclusionMode,
  type OcclusionShape,
  type OcclusionMode,
} from "../utils/imageOcclusion";

type Card = AnkiDB2Data["cards"][number];

const props = defineProps<{
  card: Card | null;
  mediaFiles?: Map<string, string>;
  isNew?: boolean;
}>();

const emit = defineEmits<{
  save: [payload: { fields: Record<string, string | null>; tags: string[]; imageFile?: File }];
  close: [];
}>();

// Editor state
const shapes = ref<OcclusionShape[]>([]);
const occlusionMode = ref<OcclusionMode>("hide-all-guess-one");
const headerText = ref("");
const backExtraText = ref("");
const editTags = ref<string[]>([]);
const newTagInput = ref("");

// Image state
const imageUrl = ref<string | null>(null);
const imageFilename = ref<string | null>(null);
const imageFile = ref<File | null>(null);
const imageNaturalWidth = ref(800);
const imageNaturalHeight = ref(600);

// Initialize from existing card
watch(
  () => props.card,
  (card) => {
    if (!card) {
      shapes.value = [];
      headerText.value = "";
      backExtraText.value = "";
      editTags.value = [];
      imageUrl.value = null;
      imageFilename.value = null;
      return;
    }

    const values = card.values;
    headerText.value = getFieldValue(values, IO_FIELD_NAMES.header);
    backExtraText.value = getFieldValue(values, IO_FIELD_NAMES.backExtra);
    editTags.value = [...card.tags];

    // Parse occlusion mode from SVG
    const occSvgRaw = getFieldValue(values, IO_FIELD_NAMES.occlusions);
    occlusionMode.value = extractOcclusionMode(occSvgRaw);

    // Parse existing shapes
    const occSvg = getFieldValue(values, IO_FIELD_NAMES.occlusions);
    shapes.value = parseOcclusionShapesForEditor(occSvg);

    // Extract image dimensions from SVG viewBox
    const viewBoxMatch = occSvg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (viewBoxMatch) {
      imageNaturalWidth.value = parseFloat(viewBoxMatch[1]!);
      imageNaturalHeight.value = parseFloat(viewBoxMatch[2]!);
    }

    // Resolve image URL
    const imgField = getFieldValue(values, IO_FIELD_NAMES.image);
    const filename = getImageFilename(imgField);
    if (filename && props.mediaFiles) {
      imageFilename.value = filename;
      imageUrl.value = props.mediaFiles.get(filename) ?? null;
    }
  },
  { immediate: true },
);

function getFieldValue(values: Record<string, string | null>, name: string): string {
  if (values[name] != null) return values[name]!;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(values)) {
    if (key.toLowerCase() === lower && value != null) return value;
  }
  return "";
}

const hasImage = computed(() => !!imageUrl.value);

function handleImagePick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loadImageFile(file);
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith("image/")) {
    loadImageFile(file);
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
}

function loadImageFile(file: File) {
  imageFile.value = file;
  const ext = file.name.split(".").pop() ?? "png";
  imageFilename.value = `io-${Date.now()}.${ext}`;

  const url = URL.createObjectURL(file);
  imageUrl.value = url;

  // Get natural dimensions
  const img = new Image();
  img.onload = () => {
    imageNaturalWidth.value = img.naturalWidth;
    imageNaturalHeight.value = img.naturalHeight;
  };
  img.src = url;

  // Reset shapes for new image
  shapes.value = [];
}

// Tag management
function addTag() {
  const tag = newTagInput.value.trim();
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag);
  }
  newTagInput.value = "";
}

function removeTag(index: number) {
  editTags.value.splice(index, 1);
}

function handleTagKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    addTag();
  }
}

function handleSave() {
  const occSvg = serializeShapesToSvg(
    shapes.value,
    imageNaturalWidth.value,
    imageNaturalHeight.value,
    occlusionMode.value,
  );
  const imgTag = imageFilename.value ? `<img src="${imageFilename.value}">` : "";

  const fields: Record<string, string | null> = {
    [IO_FIELD_NAMES.image]: imgTag || null,
    [IO_FIELD_NAMES.header]: headerText.value || null,
    [IO_FIELD_NAMES.backExtra]: backExtraText.value || null,
    [IO_FIELD_NAMES.occlusions]: occSvg || null,
  };

  emit("save", {
    fields,
    tags: [...editTags.value],
    imageFile: imageFile.value ?? undefined,
  });
}
</script>

<template>
  <div class="io-note-editor">
    <!-- Image picker for new notes -->
    <div v-if="!hasImage" class="io-image-picker" @drop="handleDrop" @dragover="handleDragOver">
      <div class="io-picker-content">
        <p class="io-picker-text">Drop an image here or click to select</p>
        <input type="file" accept="image/*" class="io-picker-input" @change="handleImagePick" />
        <Button variant="secondary" @click="($refs.fileInput as HTMLInputElement)?.click()">
          Choose Image
        </Button>
      </div>
    </div>

    <!-- Mask editor -->
    <template v-if="hasImage && imageUrl">
      <ImageOcclusionEditor
        v-model="shapes"
        v-model:occlusion-mode="occlusionMode"
        :image-url="imageUrl"
      />
    </template>

    <!-- Text fields -->
    <div class="io-text-fields">
      <div class="field-group">
        <label class="field-label">Header</label>
        <TiptapEditor v-model="headerText" :media-files="mediaFiles" />
      </div>
      <div class="field-group">
        <label class="field-label">Back Extra</label>
        <TiptapEditor v-model="backExtraText" :media-files="mediaFiles" />
      </div>
    </div>

    <!-- Tags -->
    <div class="tags-section">
      <label class="field-label">Tags</label>
      <div class="tags-list">
        <span v-for="(tag, i) in editTags" :key="tag" class="tag-badge">
          {{ tag }}
          <button class="tag-remove" @click="removeTag(i)">&times;</button>
        </span>
      </div>
      <div class="tag-add">
        <input
          v-model="newTagInput"
          type="text"
          class="tag-input"
          placeholder="Add tag..."
          @keydown="handleTagKeydown"
        />
        <Button variant="secondary" size="sm" @click="addTag">Add</Button>
      </div>
    </div>

    <!-- Actions -->
    <div class="io-actions">
      <Button variant="secondary" @click="emit('close')">Cancel</Button>
      <Button variant="primary" :disabled="!hasImage || shapes.length === 0" @click="handleSave">
        Save
      </Button>
    </div>
  </div>
</template>

<style scoped>
.io-note-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.io-image-picker {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
  position: relative;
  cursor: pointer;
}

.io-picker-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-2);
}

.io-picker-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.io-picker-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.io-text-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.field-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.tags-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-1);
}

.tag-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 1px var(--spacing-1-5);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.tag-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--color-text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.tag-remove:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.tag-add {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}

.tag-input {
  flex: 1;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-sizing: border-box;
}

.tag-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}

.io-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}
</style>
