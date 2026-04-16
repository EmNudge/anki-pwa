import { ref, computed, type Ref } from "vue";
import type { OcclusionShape } from "../utils/imageOcclusion";

let shapeIdCounter = 0;
function generateId(): string {
  return `shape-${Date.now()}-${++shapeIdCounter}`;
}

export type IoTool = "select" | "rect" | "ellipse";

export function useImageOcclusionEditor(initialShapes: OcclusionShape[] = []) {
  const shapes: Ref<OcclusionShape[]> = ref([...initialShapes]);
  const selectedShapeId = ref<string | null>(null);
  const activeTool = ref<IoTool>("rect");
  const isDrawing = ref(false);

  // Internal drawing state (not reactive for performance)
  let drawStartX = 0;
  let drawStartY = 0;
  let drawingShapeId: string | null = null;

  const selectedShape = computed(() =>
    shapes.value.find((s) => s.id === selectedShapeId.value) ?? null,
  );

  const nextOrdinal = computed(() => {
    const max = shapes.value.reduce((m, s) => Math.max(m, s.ordinal), 0);
    return max + 1;
  });

  function setTool(tool: IoTool) {
    activeTool.value = tool;
    if (tool !== "select") {
      selectedShapeId.value = null;
    }
  }

  function selectShape(id: string | null) {
    selectedShapeId.value = id;
  }

  function startDraw(x: number, y: number) {
    if (activeTool.value === "select") return;

    const id = generateId();
    const shape: OcclusionShape = {
      id,
      type: activeTool.value,
      ordinal: nextOrdinal.value,
      x,
      y,
      width: 0,
      height: 0,
    };

    shapes.value = [...shapes.value, shape];
    drawingShapeId = id;
    drawStartX = x;
    drawStartY = y;
    isDrawing.value = true;
    selectedShapeId.value = id;
  }

  function updateDraw(x: number, y: number) {
    if (!isDrawing.value || !drawingShapeId) return;

    const minX = Math.min(drawStartX, x);
    const minY = Math.min(drawStartY, y);
    const w = Math.abs(x - drawStartX);
    const h = Math.abs(y - drawStartY);

    shapes.value = shapes.value.map((s) =>
      s.id === drawingShapeId ? { ...s, x: minX, y: minY, width: w, height: h } : s,
    );
  }

  function endDraw() {
    if (!isDrawing.value || !drawingShapeId) return;

    // Remove if too small (accidental click)
    const shape = shapes.value.find((s) => s.id === drawingShapeId);
    if (shape && shape.width < 5 && shape.height < 5) {
      shapes.value = shapes.value.filter((s) => s.id !== drawingShapeId);
      selectedShapeId.value = null;
    }

    drawingShapeId = null;
    isDrawing.value = false;
  }

  function moveShape(id: string, dx: number, dy: number) {
    shapes.value = shapes.value.map((s) =>
      s.id === id ? { ...s, x: s.x + dx, y: s.y + dy } : s,
    );
  }

  function resizeShape(
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    shapes.value = shapes.value.map((s) =>
      s.id === id ? { ...s, ...bounds } : s,
    );
  }

  function deleteShape(id: string) {
    shapes.value = shapes.value.filter((s) => s.id !== id);
    if (selectedShapeId.value === id) {
      selectedShapeId.value = null;
    }
  }

  function deleteSelectedShape() {
    if (selectedShapeId.value) {
      deleteShape(selectedShapeId.value);
    }
  }

  function setShapes(newShapes: OcclusionShape[]) {
    shapes.value = [...newShapes];
    selectedShapeId.value = null;
  }

  return {
    shapes,
    selectedShapeId,
    activeTool,
    isDrawing,
    selectedShape,
    nextOrdinal,
    setTool,
    selectShape,
    startDraw,
    updateDraw,
    endDraw,
    moveShape,
    resizeShape,
    deleteShape,
    deleteSelectedShape,
    setShapes,
  };
}
