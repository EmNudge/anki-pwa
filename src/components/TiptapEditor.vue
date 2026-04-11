<script setup lang="ts">
import { watch, onBeforeUnmount } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

const props = defineProps<{
  modelValue: string;
  mediaFiles?: Map<string, string>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

/** Replace bare media filenames in src="" with object URLs */
function resolveMedia(html: string): string {
  if (!props.mediaFiles || props.mediaFiles.size === 0) return html;
  const normalized = new Map<string, string>();
  for (const [k, v] of props.mediaFiles) {
    normalized.set(k.normalize("NFC").toLowerCase(), v);
  }
  return html.replace(/src="([^"]+)"/g, (match, filename: string) => {
    const url = normalized.get(filename.normalize("NFC").toLowerCase());
    return url ? `src="${url}"` : match;
  });
}

/** Replace object URLs back with original filenames */
function unresolveMedia(html: string): string {
  if (!props.mediaFiles || props.mediaFiles.size === 0) return html;
  const urlToName = new Map<string, string>();
  for (const [name, url] of props.mediaFiles) {
    urlToName.set(url, name);
  }
  return html.replace(/src="([^"]+)"/g, (match, url: string) => {
    const name = urlToName.get(url);
    return name ? `src="${name}"` : match;
  });
}

const editor = useEditor({
  content: resolveMedia(props.modelValue),
  extensions: [
    StarterKit,
    Image.configure({ inline: true, allowBase64: true }),
  ],
  onUpdate({ editor: e }) {
    emit("update:modelValue", unresolveMedia(e.getHTML()));
  },
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const current = unresolveMedia(editor.value.getHTML());
    if (current !== val) {
      editor.value.commands.setContent(resolveMedia(val));
    }
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div v-if="editor" class="tiptap-wrapper">
    <div class="tiptap-toolbar">
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('bold') }]"
        title="Bold"
        @click="editor.chain().focus().toggleBold().run()"
      >
        B
      </button>
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('italic') }]"
        title="Italic"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('strike') }]"
        title="Strikethrough"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        <s>S</s>
      </button>
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('code') }]"
        title="Code"
        @click="editor.chain().focus().toggleCode().run()"
      >
        &lt;/&gt;
      </button>
      <span class="tb-sep" />
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('bulletList') }]"
        title="Bullet list"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        &bull;
      </button>
      <button
        type="button"
        :class="['tb-btn', { active: editor.isActive('orderedList') }]"
        title="Ordered list"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        1.
      </button>
      <span class="tb-sep" />
      <button type="button" class="tb-btn" title="Undo" @click="editor.chain().focus().undo().run()">
        ↩
      </button>
      <button type="button" class="tb-btn" title="Redo" @click="editor.chain().focus().redo().run()">
        ↪
      </button>
    </div>
    <EditorContent :editor="editor" class="tiptap-content" />
  </div>
</template>

<style scoped>
.tiptap-wrapper {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface-elevated);
}

.tiptap-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--spacing-1);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-wrap: wrap;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 var(--spacing-1);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
}

.tb-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.tb-btn.active {
  color: var(--color-text-primary);
  background: var(--color-surface-elevated);
  box-shadow: var(--shadow-sm);
}

.tb-sep {
  width: 1px;
  height: 18px;
  margin: 0 var(--spacing-1);
  background: var(--color-border);
}

.tiptap-content {
  min-height: 100px;
  max-height: 300px;
  overflow-y: auto;
}

.tiptap-content :deep(.tiptap) {
  padding: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  outline: none;
  min-height: 80px;
}

.tiptap-content :deep(.tiptap p) {
  margin: 0 0 0.5em 0;
}

.tiptap-content :deep(.tiptap p:last-child) {
  margin-bottom: 0;
}

.tiptap-content :deep(.tiptap img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

.tiptap-content :deep(.tiptap ul),
.tiptap-content :deep(.tiptap ol) {
  padding-left: 1.5em;
  margin: 0 0 0.5em 0;
}

.tiptap-content :deep(.tiptap code) {
  padding: 1px 4px;
  font-family: var(--font-family-mono, monospace);
  font-size: 0.9em;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.tiptap-content :deep(.tiptap pre) {
  padding: var(--spacing-2);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}

.tiptap-content :deep(.tiptap blockquote) {
  padding-left: var(--spacing-3);
  border-left: 3px solid var(--color-border);
  color: var(--color-text-secondary);
  margin: 0 0 0.5em 0;
}
</style>
