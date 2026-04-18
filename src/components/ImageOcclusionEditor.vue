<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useImageOcclusionEditor, type IoTool } from "../composables/useImageOcclusionEditor";
import type { OcclusionShape, OcclusionMode } from "../utils/imageOcclusion";
import { Button } from "../design-system";

const props = defineProps<{
  imageUrl: string;
  modelValue: OcclusionShape[];
  occlusionMode?: OcclusionMode;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [shapes: OcclusionShape[]];
  "update:occlusionMode": [mode: OcclusionMode];
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const imageNaturalWidth = ref(800);
const imageNaturalHeight = ref(600);
const imageLoaded = ref(false);

const editor = useImageOcclusionEditor(props.modelValue);

// Sync occlusion mode from prop
if (props.occlusionMode) {
  editor.setOcclusionMode(props.occlusionMode);
}
watch(
  () => props.occlusionMode,
  (val) => {
    if (val && val !== editor.occlusionMode.value) {
      editor.setOcclusionMode(val);
    }
  },
);
watch(
  () => editor.occlusionMode.value,
  (val) => emit("update:occlusionMode", val),
);

// Sync external model → editor
watch(
  () => props.modelValue,
  (val) => {
    if (JSON.stringify(val) !== JSON.stringify(editor.shapes.value)) {
      editor.setShapes(val);
    }
  },
);

// Sync editor → external model
watch(
  () => editor.shapes.value,
  (val) => {
    emit("update:modelValue", val);
  },
  { deep: true },
);

// Load image to get natural dimensions
onMounted(() => {
  const img = new Image();
  img.onload = () => {
    imageNaturalWidth.value = img.naturalWidth;
    imageNaturalHeight.value = img.naturalHeight;
    imageLoaded.value = true;
  };
  img.src = props.imageUrl;
});

// Keyboard handling
function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (editor.selectedShapeId.value) {
      e.preventDefault();
      editor.deleteSelectedShape();
    }
  }
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

// Convert screen pointer coords to SVG viewBox coords
function toSvgPoint(e: PointerEvent): { x: number; y: number } | null {
  const svg = svgRef.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  return {
    x: inv.a * e.clientX + inv.c * e.clientY + inv.e,
    y: inv.b * e.clientX + inv.d * e.clientY + inv.f,
  };
}

// Interaction state
type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
let dragState: {
  shapeId: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
} | null = null;
let resizeHandle: { shapeId: string; dir: HandleDir; anchorX: number; anchorY: number } | null =
  null;
const MIN_DRAG_THRESHOLD = 5;
let hasDragged = false;

function onPointerDown(e: PointerEvent) {
  if (props.readonly) return;
  const pt = toSvgPoint(e);
  if (!pt) return;
  hasDragged = false;

  if (editor.activeTool.value === "select") {
    const target = e.target as Element;

    // Check resize handles first
    const handleEl = target.closest("[data-handle]");
    if (handleEl && editor.selectedShape.value) {
      const dir = handleEl.getAttribute("data-handle") as HandleDir;
      const shape = editor.selectedShape.value;
      // Anchor is the opposite corner/edge
      const anchors: Record<HandleDir, { x: number; y: number }> = {
        nw: { x: shape.x + shape.width, y: shape.y + shape.height },
        n: { x: shape.x, y: shape.y + shape.height },
        ne: { x: shape.x, y: shape.y + shape.height },
        e: { x: shape.x, y: shape.y },
        se: { x: shape.x, y: shape.y },
        s: { x: shape.x, y: shape.y },
        sw: { x: shape.x + shape.width, y: shape.y },
        w: { x: shape.x + shape.width, y: shape.y },
      };
      resizeHandle = { shapeId: shape.id, dir, anchorX: anchors[dir].x, anchorY: anchors[dir].y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    // Check shape click
    const shapeEl = target.closest("[data-shape-id]");
    if (shapeEl) {
      const id = shapeEl.getAttribute("data-shape-id")!;
      editor.selectShape(id);
      const shape = editor.shapes.value.find((s) => s.id === id);
      if (shape) {
        dragState = {
          shapeId: id,
          startX: pt.x,
          startY: pt.y,
          origX: shape.x,
          origY: shape.y,
          origW: shape.width,
          origH: shape.height,
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    } else {
      editor.selectShape(null);
    }
  } else {
    editor.startDraw(pt.x, pt.y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
}

function onPointerMove(e: PointerEvent) {
  if (props.readonly) return;
  const pt = toSvgPoint(e);
  if (!pt) return;

  if (editor.isDrawing.value) {
    editor.updateDraw(pt.x, pt.y);
  } else if (resizeHandle) {
    // Resize based on handle direction
    const { dir, anchorX, anchorY, shapeId } = resizeHandle;
    const shape = editor.shapes.value.find((s) => s.id === shapeId);
    if (!shape) return;

    let newX = shape.x,
      newY = shape.y,
      newW = shape.width,
      newH = shape.height;

    if (dir.includes("w") || dir.includes("e")) {
      const minX = dir.includes("w") ? pt.x : anchorX;
      const maxX = dir.includes("w") ? anchorX : pt.x;
      newX = Math.min(minX, maxX);
      newW = Math.abs(maxX - minX);
    }
    if (dir.includes("n") || dir.includes("s")) {
      const minY = dir.includes("n") ? pt.y : anchorY;
      const maxY = dir.includes("n") ? anchorY : pt.y;
      newY = Math.min(minY, maxY);
      newH = Math.abs(maxY - minY);
    }
    // Edge-only handles: preserve the other axis
    if (dir === "n" || dir === "s") {
      newX = shape.x;
      newW = shape.width;
    }
    if (dir === "e" || dir === "w") {
      newY = shape.y;
      newH = shape.height;
    }

    // Enforce minimum size
    if (newW < 10) newW = 10;
    if (newH < 10) newH = 10;

    editor.resizeShape(shapeId, { x: newX, y: newY, width: newW, height: newH });
  } else if (dragState) {
    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;
    if (!hasDragged && Math.abs(dx) < MIN_DRAG_THRESHOLD && Math.abs(dy) < MIN_DRAG_THRESHOLD)
      return;
    hasDragged = true;
    editor.resizeShape(dragState.shapeId, {
      x: dragState.origX + dx,
      y: dragState.origY + dy,
      width: dragState.origW,
      height: dragState.origH,
    });
  }
}

function onPointerUp(_e: PointerEvent) {
  if (editor.isDrawing.value) {
    editor.endDraw();
  }
  dragState = null;
  resizeHandle = null;
}

const tools: { key: IoTool; label: string }[] = [
  { key: "select", label: "Select" },
  { key: "rect", label: "Rectangle" },
  { key: "ellipse", label: "Ellipse" },
];

const HANDLE_SIZE = 8;
const HANDLE_TOUCH_SIZE = 20; // Invisible larger touch target

type HandleDef = { dir: HandleDir; cx: number; cy: number };
function getHandles(shape: OcclusionShape): HandleDef[] {
  const { x, y, width: w, height: h } = shape;
  return [
    { dir: "nw", cx: x, cy: y },
    { dir: "n", cx: x + w / 2, cy: y },
    { dir: "ne", cx: x + w, cy: y },
    { dir: "e", cx: x + w, cy: y + h / 2 },
    { dir: "se", cx: x + w, cy: y + h },
    { dir: "s", cx: x + w / 2, cy: y + h },
    { dir: "sw", cx: x, cy: y + h },
    { dir: "w", cx: x, cy: y + h / 2 },
  ];
}

const handleCursors: Record<HandleDir, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};
</script>

<template>
  <div class="io-editor">
    <div v-if="!readonly" class="io-toolbar">
      <Button
        v-for="tool in tools"
        :key="tool.key"
        :variant="editor.activeTool.value === tool.key ? 'primary' : 'secondary'"
        size="sm"
        @click="editor.setTool(tool.key)"
      >
        {{ tool.label }}
      </Button>
      <span class="io-toolbar-sep" />
      <Button
        :variant="editor.occlusionMode.value === 'hide-all-guess-one' ? 'primary' : 'secondary'"
        size="sm"
        @click="editor.setOcclusionMode('hide-all-guess-one')"
      >
        Hide All
      </Button>
      <Button
        :variant="editor.occlusionMode.value === 'hide-one' ? 'primary' : 'secondary'"
        size="sm"
        @click="editor.setOcclusionMode('hide-one')"
      >
        Hide One
      </Button>
      <span class="io-toolbar-sep" />
      <Button
        variant="danger"
        size="sm"
        :disabled="!editor.selectedShapeId.value"
        @click="editor.deleteSelectedShape()"
      >
        Delete
      </Button>
    </div>
    <div class="io-canvas-wrapper">
      <svg
        v-if="imageLoaded"
        ref="svgRef"
        class="io-canvas"
        :viewBox="`0 0 ${imageNaturalWidth} ${imageNaturalHeight}`"
        preserveAspectRatio="xMidYMid meet"
        @pointerdown.prevent="onPointerDown"
        @pointermove.prevent="onPointerMove"
        @pointerup.prevent="onPointerUp"
      >
        <image :href="imageUrl" :width="imageNaturalWidth" :height="imageNaturalHeight" />

        <template v-for="shape in editor.shapes.value" :key="shape.id">
          <rect
            v-if="shape.type === 'rect'"
            :data-shape-id="shape.id"
            :x="shape.x"
            :y="shape.y"
            :width="shape.width"
            :height="shape.height"
            fill="#ffeba2"
            fill-opacity="0.6"
            stroke="#2d2d2d"
            stroke-width="1"
            :class="{
              'io-shape': true,
              'io-shape-selected': shape.id === editor.selectedShapeId.value,
            }"
            style="cursor: pointer"
          />
          <ellipse
            v-else-if="shape.type === 'ellipse'"
            :data-shape-id="shape.id"
            :cx="shape.x + shape.width / 2"
            :cy="shape.y + shape.height / 2"
            :rx="shape.width / 2"
            :ry="shape.height / 2"
            fill="#ffeba2"
            fill-opacity="0.6"
            stroke="#2d2d2d"
            stroke-width="1"
            :class="{
              'io-shape': true,
              'io-shape-selected': shape.id === editor.selectedShapeId.value,
            }"
            style="cursor: pointer"
          />
          <!-- Ordinal label -->
          <text
            :x="shape.x + shape.width / 2"
            :y="shape.y + shape.height / 2"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="16"
            font-weight="bold"
            fill="#333"
            pointer-events="none"
          >
            {{ shape.ordinal }}
          </text>
        </template>

        <!-- Selection outline + resize handles -->
        <template v-if="editor.selectedShape.value && !readonly">
          <rect
            :x="editor.selectedShape.value.x - 2"
            :y="editor.selectedShape.value.y - 2"
            :width="editor.selectedShape.value.width + 4"
            :height="editor.selectedShape.value.height + 4"
            fill="none"
            stroke="#2196f3"
            stroke-width="2"
            stroke-dasharray="6 3"
            pointer-events="none"
          />
          <!-- Resize handles -->
          <template v-for="handle in getHandles(editor.selectedShape.value)" :key="handle.dir">
            <!-- Invisible larger touch target -->
            <rect
              :data-handle="handle.dir"
              :x="handle.cx - HANDLE_TOUCH_SIZE / 2"
              :y="handle.cy - HANDLE_TOUCH_SIZE / 2"
              :width="HANDLE_TOUCH_SIZE"
              :height="HANDLE_TOUCH_SIZE"
              fill="transparent"
              :style="{ cursor: handleCursors[handle.dir] }"
            />
            <!-- Visible handle -->
            <rect
              :x="handle.cx - HANDLE_SIZE / 2"
              :y="handle.cy - HANDLE_SIZE / 2"
              :width="HANDLE_SIZE"
              :height="HANDLE_SIZE"
              fill="white"
              stroke="#2196f3"
              stroke-width="1.5"
              pointer-events="none"
            />
          </template>
        </template>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.io-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.io-toolbar {
  display: flex;
  gap: var(--spacing-1);
  flex-wrap: wrap;
  align-items: center;
}

.io-toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 var(--spacing-1);
}

.io-canvas-wrapper {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface-elevated);
}

.io-canvas {
  display: block;
  width: 100%;
  height: auto;
  max-height: 60vh;
  touch-action: none;
  user-select: none;
}

.io-shape-selected {
  stroke: #2196f3;
  stroke-width: 2;
}
</style>
