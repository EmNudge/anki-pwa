import { ref, computed, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from "vue";

interface VirtualScrollOptions<T> {
  items: ComputedRef<T[]> | Ref<T[]>;
  rowHeight?: number;
  overscan?: number;
}

export function useVirtualScroll<T>({
  items,
  rowHeight = 30,
  overscan = 10,
}: VirtualScrollOptions<T>) {
  const scrollContainerRef = ref<HTMLElement | null>(null);
  const scrollTop = ref(0);
  const containerHeight = ref(600);
  let resizeObserver: ResizeObserver | null = null;

  function onScroll(e: Event) {
    scrollTop.value = (e.target as HTMLElement).scrollTop;
  }

  onMounted(() => {
    if (scrollContainerRef.value) {
      containerHeight.value = scrollContainerRef.value.clientHeight;
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight.value = entry.contentRect.height;
        }
      });
      resizeObserver.observe(scrollContainerRef.value);
    }
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
  });

  const virtualSlice = computed(() => {
    const total = items.value.length;
    const headerHeight = rowHeight;
    const startIndex = Math.max(
      0,
      Math.floor((scrollTop.value - headerHeight) / rowHeight) - overscan,
    );
    const visibleCount = Math.ceil(containerHeight.value / rowHeight) + overscan * 2;
    const endIndex = Math.min(total, startIndex + visibleCount);

    return {
      startIndex,
      endIndex,
      totalHeight: total * rowHeight + headerHeight,
      offsetY: startIndex * rowHeight + headerHeight,
      rows: items.value.slice(startIndex, endIndex),
    };
  });

  return {
    scrollContainerRef,
    onScroll,
    virtualSlice,
  };
}
