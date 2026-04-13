<script setup lang="ts">
import { ref } from "vue";
import type { TagTreeNode } from "../utils/tagTree";

defineProps<{
  nodes: TagTreeNode[];
  activeTag: string | null;
}>();

const emit = defineEmits<{
  select: [tag: string | null];
  rename: [tag: string];
  delete: [tag: string];
}>();

const expandedPaths = ref(new Set<string>());

function toggleExpand(node: TagTreeNode) {
  const next = new Set(expandedPaths.value);
  if (next.has(node.fullPath)) {
    next.delete(node.fullPath);
  } else {
    next.add(node.fullPath);
  }
  expandedPaths.value = next;
}

function isExpanded(node: TagTreeNode): boolean {
  return expandedPaths.value.has(node.fullPath);
}

const contextMenuTag = ref<string | null>(null);
const contextMenuPos = ref({ x: 0, y: 0 });

function showContextMenu(e: MouseEvent, tag: string) {
  e.preventDefault();
  contextMenuTag.value = tag;
  contextMenuPos.value = { x: e.clientX, y: e.clientY };
  window.addEventListener("click", hideContextMenu, { once: true });
}

function hideContextMenu() {
  contextMenuTag.value = null;
}

function handleRename() {
  if (contextMenuTag.value) emit("rename", contextMenuTag.value);
  contextMenuTag.value = null;
}

function handleDelete() {
  if (contextMenuTag.value) emit("delete", contextMenuTag.value);
  contextMenuTag.value = null;
}
</script>

<template>
  <div class="tag-tree">
    <button
      :class="['tag-tree-item', 'tag-tree-root', { 'tag-tree-item--active': activeTag === null }]"
      @click="emit('select', null)"
    >
      All Tags
    </button>

    <template v-for="node in nodes" :key="node.fullPath">
      <TagTreeNodeItem
        :node="node"
        :depth="0"
        :active-tag="activeTag"
        :expanded-paths="expandedPaths"
        @select="emit('select', $event)"
        @toggle="toggleExpand($event)"
        @contextmenu="showContextMenu($event.event, $event.tag)"
      />
    </template>

    <Teleport to="body">
      <div
        v-if="contextMenuTag"
        class="tag-context-menu"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
      >
        <button class="tag-context-item" @click="handleRename">Rename tag</button>
        <button class="tag-context-item tag-context-item--danger" @click="handleDelete">
          Delete tag
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
import { defineComponent, h, type PropType } from "vue";

const TagTreeNodeItem = defineComponent({
  name: "TagTreeNodeItem",
  props: {
    node: { type: Object as PropType<TagTreeNode>, required: true },
    depth: { type: Number, required: true },
    activeTag: { type: String as PropType<string | null>, default: null },
    expandedPaths: { type: Set as unknown as PropType<Set<string>>, required: true },
  },
  emits: ["select", "toggle", "contextmenu"],
  setup(props, { emit }) {
    return () => {
      const node = props.node;
      const expanded = props.expandedPaths.has(node.fullPath);
      const hasChildren = node.children.length > 0;

      const chevron = hasChildren
        ? h(
            "span",
            {
              class: ["tag-tree-chevron", expanded ? "tag-tree-chevron--open" : ""],
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                emit("toggle", node);
              },
            },
            "\u25B6",
          )
        : h("span", { class: "tag-tree-chevron tag-tree-chevron--hidden" });

      const button = h(
        "button",
        {
          class: [
            "tag-tree-item",
            props.activeTag === node.fullPath ? "tag-tree-item--active" : "",
          ],
          style: { paddingLeft: `${(props.depth + 1) * 12 + 8}px` },
          onClick: () => emit("select", node.fullPath),
          onContextmenu: (e: MouseEvent) => {
            e.preventDefault();
            emit("contextmenu", { event: e, tag: node.fullPath });
          },
        },
        [
          chevron,
          h("span", { class: "tag-tree-label" }, node.name),
          node.noteCount > 0
            ? h("span", { class: "tag-tree-count" }, String(node.noteCount))
            : null,
        ],
      );

      const children =
        expanded && hasChildren
          ? node.children
              .sort((a: TagTreeNode, b: TagTreeNode) => a.name.localeCompare(b.name))
              .map((child: TagTreeNode) =>
                h(TagTreeNodeItem, {
                  key: child.fullPath,
                  node: child,
                  depth: props.depth + 1,
                  activeTag: props.activeTag,
                  expandedPaths: props.expandedPaths,
                  onSelect: (tag: string) => emit("select", tag),
                  onToggle: (n: TagTreeNode) => emit("toggle", n),
                  onContextmenu: (payload: { event: MouseEvent; tag: string }) =>
                    emit("contextmenu", payload),
                }),
              )
          : [];

      return h("div", [button, ...children]);
    };
  },
});
</script>

<style scoped>
.tag-tree {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-1) 0;
  overflow-y: auto;
}

.tag-tree-root {
  font-weight: var(--font-weight-semibold);
  padding-left: var(--spacing-2) !important;
}

.tag-tree-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 0.1s;
  white-space: nowrap;
}

.tag-tree-item:hover {
  background: var(--color-surface-hover);
}

.tag-tree-item--active {
  color: var(--color-primary);
  background: var(--color-surface-elevated);
  font-weight: var(--font-weight-medium);
}

:deep(.tag-tree-chevron) {
  font-size: 8px;
  width: 12px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  color: var(--color-text-tertiary);
}

:deep(.tag-tree-chevron--open) {
  transform: rotate(90deg);
}

:deep(.tag-tree-chevron--hidden) {
  visibility: hidden;
}

:deep(.tag-tree-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.tag-tree-count) {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.tag-context-menu {
  position: fixed;
  z-index: 200;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
  padding: var(--spacing-1) 0;
  min-width: 140px;
}

.tag-context-item {
  display: block;
  width: 100%;
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}

.tag-context-item:hover {
  background: var(--color-surface-hover);
}

.tag-context-item--danger {
  color: var(--color-error-500, #ef4444);
}
</style>
