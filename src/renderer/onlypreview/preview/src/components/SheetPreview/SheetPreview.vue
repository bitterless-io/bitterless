<template>
  <section
    name="onlypreview__sheetPreview"
    class="onlypreview-sheet"
    :aria-label="onlyPreviewI18n.preview.sheetLabel"
  >
    <header
      name="onlypreview__sheetTabs"
      class="onlypreview-sheet__tabs"
      role="tablist"
      :aria-label="onlyPreviewI18n.preview.sheetLabel"
    >
      <button
        v-for="sheet in manifest.sheets"
        :id="sheetTabDomId(sheet.id)"
        :key="sheet.id"
        :ref="(element) => setSheetTabElement(sheet.id, element)"
        name="onlypreview__sheetTab"
        type="button"
        class="onlypreview-sheet__tab"
        :class="{ 'onlypreview-sheet__tab--active': sheet.id === activeSheetId }"
        :aria-selected="sheet.id === activeSheetId"
        aria-controls="onlypreview-sheet-grid"
        :tabindex="sheet.id === activeSheetId ? 0 : -1"
        role="tab"
        @click="activateSheet(sheet.id)"
        @keydown="handleTabKeydown($event, sheet.id)"
      >
        {{ sheet.name }}
      </button>
      <span
        v-if="manifest.coverage.kind === 'partial'"
        name="onlypreview__sheetCoverage"
        class="onlypreview-sheet__coverage"
      >
        {{ partialCoverageLabel }}
      </span>
    </header>

    <div
      v-if="layout && rowAxis && columnAxis"
      name="onlypreview__sheetGrid"
      class="onlypreview-sheet__grid"
    >
      <div class="onlypreview-sheet__corner" aria-hidden="true"></div>
      <div class="onlypreview-sheet__column-headers" aria-hidden="true">
        <div
          class="onlypreview-sheet__column-header-track"
          :style="{
            width: `${columnAxis.offsets[columnAxis.count]}px`,
            transform: `translateX(${-scrollLeft}px)`
          }"
        >
          <span
            v-for="column in visibleColumns"
            :key="column"
            name="onlypreview__sheetColumnHeader"
            class="onlypreview-sheet__column-header"
            :style="axisCellStyle(columnAxis, column, 'column')"
          >
            {{ columnLabel(column) }}
          </span>
        </div>
      </div>
      <div class="onlypreview-sheet__row-headers" aria-hidden="true">
        <div
          class="onlypreview-sheet__row-header-track"
          :style="{
            height: `${rowAxis.offsets[rowAxis.count]}px`,
            transform: `translateY(${-scrollTop}px)`
          }"
        >
          <span
            v-for="row in visibleRows"
            :key="row"
            name="onlypreview__sheetRowHeader"
            class="onlypreview-sheet__row-header"
            :style="axisCellStyle(rowAxis, row, 'row')"
          >
            {{ row }}
          </span>
        </div>
      </div>
      <div
        id="onlypreview-sheet-grid"
        ref="viewportElement"
        name="onlypreview__sheetViewport"
        class="onlypreview-sheet__viewport"
        role="grid"
        tabindex="0"
        :aria-label="onlyPreviewI18n.preview.sheetLabel"
        :aria-labelledby="sheetTabDomId(activeSheetId)"
        :aria-rowcount="layout.rowCount"
        :aria-colcount="layout.columnCount"
        :aria-activedescendant="activeDescendantId"
        @scroll="handleScroll"
        @keydown="handleGridKeydown"
      >
        <div
          class="onlypreview-sheet__canvas"
          :style="{
            width: `${columnAxis.offsets[columnAxis.count]}px`,
            height: `${rowAxis.offsets[rowAxis.count]}px`
          }"
        >
          <div
            v-for="renderedRow in renderedRows"
            :key="renderedRow.row"
            class="onlypreview-sheet__virtual-row"
            role="row"
            :aria-rowindex="renderedRow.row"
          >
            <div
              v-for="cell in renderedRow.cells"
              :id="cellDomId(cell)"
              :key="cell.key"
              name="onlypreview__sheetCell"
              class="onlypreview-sheet__cell"
              :class="{
                'onlypreview-sheet__cell--active':
                  cell.row === activeCell.row && cell.column === activeCell.column,
                'onlypreview-sheet__cell--match':
                  activeSearchTarget?.sheetId === activeSheetId &&
                  activeSearchTarget.row === cell.row &&
                  activeSearchTarget.column === cell.column
              }"
              :style="cell.css"
              role="gridcell"
              :aria-colindex="cell.column"
              :aria-rowspan="cell.rowSpan > 1 ? cell.rowSpan : undefined"
              :aria-colspan="cell.columnSpan > 1 ? cell.columnSpan : undefined"
              @mousedown.prevent="setActiveCell(cell.row, cell.column)"
            >
              <span>{{ cell.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import type { OnlyPreviewSheetSessionApi } from '../../onlyPreviewSheet.service';
import {
  getOnlyPreviewSheetAxisOffset,
  getOnlyPreviewSheetAxisSize,
  getOnlyPreviewSheetSpanSize,
  type OnlyPreviewSheetAxis
} from '../../onlyPreviewSheetViewport.service';
import type {
  OnlyPreviewSheetCell,
  OnlyPreviewSheetCellStyle,
  OnlyPreviewSheetManifest,
  OnlyPreviewSheetMerge,
  OnlyPreviewSheetSearchResult,
  OnlyPreviewSheetSearchTarget
} from '../../workers/onlyPreviewSheetWorker.contract';
import { createOnlyPreviewSheetPreviewStore } from './SheetPreview.store';

interface RenderedCell {
  key: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  css: Record<string, string>;
}

interface RenderedRow {
  row: number;
  cells: RenderedCell[];
}

const props = defineProps<{
  session: OnlyPreviewSheetSessionApi;
  manifest: OnlyPreviewSheetManifest;
  reportingRevision: string;
}>();
const emit = defineEmits<{ ready: [] }>();

const viewportElement = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);
const scrollTop = ref(0);
const sheetTabElements = new Map<number, HTMLButtonElement>();
let mounted = false;
let scrollFrame = 0;
let resizeObserver: ResizeObserver | null = null;
let observedViewportElement: HTMLElement | null = null;

const observeViewport = (): void => {
  const element = viewportElement.value;
  if (!resizeObserver || !element || element === observedViewportElement) return;
  if (observedViewportElement) resizeObserver.unobserve(observedViewportElement);
  resizeObserver.observe(element);
  observedViewportElement = element;
};

const sheetPreviewStore = createOnlyPreviewSheetPreviewStore({
  session: props.session,
  manifest: props.manifest,
  reportingRevision: props.reportingRevision,
  hooks: {
    getViewportMetrics: () => {
      const element = viewportElement.value;
      return element
        ? {
            scrollLeft: element.scrollLeft,
            scrollTop: element.scrollTop,
            width: element.clientWidth,
            height: element.clientHeight
          }
        : null;
    },
    prepareViewport: async () => {
      await nextTick();
      observeViewport();
      const element = viewportElement.value;
      if (!element) return;
      element.scrollLeft = 0;
      element.scrollTop = 0;
      scrollLeft.value = 0;
      scrollTop.value = 0;
    },
    afterViewportInstall: async () => {
      await nextTick();
    },
    scrollToCell: (left, top) => {
      const element = viewportElement.value;
      if (!element) return false;
      element.scrollTo({
        left,
        top,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
      return true;
    },
    reportReady: () => emit('ready')
  }
});

const activeSheetId = computed(() => sheetPreviewStore.activeSheetId);
const layout = computed(() => sheetPreviewStore.layout);
const viewport = computed(() => sheetPreviewStore.viewport);
const rowAxis = computed(() => sheetPreviewStore.rowAxis);
const columnAxis = computed(() => sheetPreviewStore.columnAxis);
const rowRange = computed(() => sheetPreviewStore.rowRange);
const columnRange = computed(() => sheetPreviewStore.columnRange);
const activeCell = computed(() => sheetPreviewStore.activeCell);
const activeSearchTarget = computed(() => sheetPreviewStore.activeSearchTarget);

const partialCoverageLabel = computed(() =>
  onlyPreviewI18n.preview.sheetPartial.replace('{count}', String(props.manifest.acceptedCells))
);

const visibleRows = computed(() => {
  const values: number[] = [];
  for (let row = rowRange.value.start; row <= rowRange.value.end; row += 1) values.push(row);
  return values;
});

const visibleColumns = computed(() => {
  const values: number[] = [];
  for (let column = columnRange.value.start; column <= columnRange.value.end; column += 1) {
    values.push(column);
  }
  return values;
});

const mergeKey = (row: number, column: number): string => `${row}:${column}`;

const cellCss = (
  row: number,
  column: number,
  merge: OnlyPreviewSheetMerge | null,
  style?: OnlyPreviewSheetCellStyle
): Record<string, string> => {
  const rows = rowAxis.value!;
  const columns = columnAxis.value!;
  const bottom = merge?.bottom ?? row;
  const right = merge?.right ?? column;
  const horizontal = style?.horizontal;
  const vertical = style?.vertical;
  return {
    left: `${getOnlyPreviewSheetAxisOffset(columns, column)}px`,
    top: `${getOnlyPreviewSheetAxisOffset(rows, row)}px`,
    width: `${getOnlyPreviewSheetSpanSize(columns, column, right)}px`,
    height: `${getOnlyPreviewSheetSpanSize(rows, row, bottom)}px`,
    justifyContent:
      horizontal === 'center' ? 'center' : horizontal === 'right' ? 'flex-end' : 'flex-start',
    alignItems: vertical === 'top' ? 'flex-start' : vertical === 'middle' ? 'center' : 'flex-end',
    whiteSpace: style?.wrap ? 'pre-wrap' : 'nowrap',
    fontWeight: style?.bold ? '650' : '400',
    fontStyle: style?.italic ? 'italic' : 'normal',
    color: style?.color ?? '#25283a',
    background: style?.fill ?? '#ffffff'
  };
};

const renderedCells = computed<RenderedCell[]>(() => {
  if (!viewport.value || !rowAxis.value || !columnAxis.value) return [];
  const sourceCells = new Map<string, OnlyPreviewSheetCell>();
  for (const cell of viewport.value.cells) sourceCells.set(mergeKey(cell.row, cell.column), cell);
  const covered = new Map<string, OnlyPreviewSheetMerge>();
  for (const merge of viewport.value.merges) {
    for (
      let row = Math.max(merge.top, rowRange.value.start);
      row <= Math.min(merge.bottom, rowRange.value.end);
      row += 1
    ) {
      for (
        let column = Math.max(merge.left, columnRange.value.start);
        column <= Math.min(merge.right, columnRange.value.end);
        column += 1
      ) {
        covered.set(mergeKey(row, column), merge);
      }
    }
  }
  const output: RenderedCell[] = [];
  const emittedMerges = new Set<string>();
  for (const row of visibleRows.value) {
    for (const column of visibleColumns.value) {
      const merge = covered.get(mergeKey(row, column)) ?? null;
      if (merge) {
        const masterKey = mergeKey(merge.top, merge.left);
        if (emittedMerges.has(masterKey)) continue;
        emittedMerges.add(masterKey);
        const source = sourceCells.get(masterKey);
        output.push({
          key: `merge:${masterKey}`,
          row: merge.top,
          column: merge.left,
          rowSpan: merge.bottom - merge.top + 1,
          columnSpan: merge.right - merge.left + 1,
          text: source?.text ?? '',
          css: cellCss(merge.top, merge.left, merge, source?.style)
        });
        continue;
      }
      const source = sourceCells.get(mergeKey(row, column));
      output.push({
        key: mergeKey(row, column),
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        text: source?.text ?? '',
        css: cellCss(row, column, null, source?.style)
      });
    }
  }
  return output;
});

const renderedRows = computed<RenderedRow[]>(() => {
  const rows = new Map<number, RenderedCell[]>();
  for (const cell of renderedCells.value) {
    const cells = rows.get(cell.row) ?? [];
    cells.push(cell);
    rows.set(cell.row, cells);
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([row, cells]) => ({
      row,
      cells: cells.sort((left, right) => left.column - right.column)
    }));
});

const cellDomId = (cell: Pick<RenderedCell, 'row' | 'column'>): string =>
  `onlypreview-sheet-${activeSheetId.value}-${cell.row}-${cell.column}`;

const activeDescendantId = computed(() => {
  const direct = renderedCells.value.find(
    (cell) => cell.row === activeCell.value.row && cell.column === activeCell.value.column
  );
  if (direct) return cellDomId(direct);
  const merge = viewport.value?.merges.find(
    (entry) =>
      activeCell.value.row >= entry.top &&
      activeCell.value.row <= entry.bottom &&
      activeCell.value.column >= entry.left &&
      activeCell.value.column <= entry.right
  );
  return merge ? cellDomId({ row: merge.top, column: merge.left }) : undefined;
});

const axisCellStyle = (
  axis: OnlyPreviewSheetAxis,
  index: number,
  direction: 'row' | 'column'
): Record<string, string> =>
  direction === 'column'
    ? {
        left: `${getOnlyPreviewSheetAxisOffset(axis, index)}px`,
        width: `${getOnlyPreviewSheetAxisSize(axis, index)}px`
      }
    : {
        top: `${getOnlyPreviewSheetAxisOffset(axis, index)}px`,
        height: `${getOnlyPreviewSheetAxisSize(axis, index)}px`
      };

const columnLabel = (column: number): string => {
  let value = column;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};

const requestVisibleViewport = (): Promise<boolean> => sheetPreviewStore.requestVisibleViewport();

const activateSheet = (sheetId: number): Promise<boolean> =>
  sheetPreviewStore.activateSheet(sheetId);

const handleScroll = (): void => {
  const element = viewportElement.value;
  if (!element) return;
  scrollLeft.value = element.scrollLeft;
  scrollTop.value = element.scrollTop;
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    void requestVisibleViewport();
  });
};

const setActiveCell = (row: number, column: number): void => {
  sheetPreviewStore.setActiveCell(row, column);
  viewportElement.value?.focus({ preventScroll: true });
};

const sheetTabDomId = (sheetId: number): string => `onlypreview-sheet-tab-${sheetId}`;

const setSheetTabElement = (sheetId: number, element: unknown): void => {
  if (element instanceof HTMLElement && element.tagName === 'BUTTON') {
    sheetTabElements.set(sheetId, element as HTMLButtonElement);
  } else sheetTabElements.delete(sheetId);
};

const focusSheetTab = async (sheetId: number): Promise<void> => {
  await nextTick();
  if (!mounted || activeSheetId.value !== sheetId) return;
  sheetTabElements.get(sheetId)?.focus({ preventScroll: true });
};

const handleTabKeydown = (event: KeyboardEvent, sheetId: number): void => {
  const currentIndex = props.manifest.sheets.findIndex((sheet) => sheet.id === sheetId);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
  else if (event.key === 'ArrowRight') {
    nextIndex = Math.min(props.manifest.sheets.length - 1, currentIndex + 1);
  } else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = props.manifest.sheets.length - 1;
  else return;
  event.preventDefault();
  const nextSheetId = props.manifest.sheets[nextIndex].id;
  void activateSheet(nextSheetId);
  void focusSheetTab(nextSheetId);
};

const revealCell = async (target: OnlyPreviewSheetSearchTarget): Promise<void> => {
  await sheetPreviewStore.revealCell(target);
};

const query = async (
  value: string,
  caseSensitive: boolean
): Promise<OnlyPreviewSheetSearchResult> => await sheetPreviewStore.query(value, caseSensitive);
const next = async (): Promise<OnlyPreviewSheetSearchResult> => await sheetPreviewStore.next();
const previous = async (): Promise<OnlyPreviewSheetSearchResult> =>
  await sheetPreviewStore.previous();
const clear = async (): Promise<OnlyPreviewSheetSearchResult> => await sheetPreviewStore.clear();
const reveal = async (ordinal: number): Promise<OnlyPreviewSheetSearchResult> =>
  await sheetPreviewStore.reveal(ordinal);

const handleGridKeydown = (event: KeyboardEvent): void => {
  if (!layout.value) return;
  let { row, column } = activeCell.value;
  if (event.key === 'ArrowUp') row -= 1;
  else if (event.key === 'ArrowDown') row += 1;
  else if (event.key === 'ArrowLeft') column -= 1;
  else if (event.key === 'ArrowRight') column += 1;
  else return;
  event.preventDefault();
  void revealCell({
    sheetId: activeSheetId.value,
    row: Math.max(1, Math.min(layout.value.rowCount, row)),
    column: Math.max(1, Math.min(layout.value.columnCount, column))
  });
};

onMounted(() => {
  mounted = true;
  resizeObserver = new ResizeObserver(() => void requestVisibleViewport());
  sheetPreviewStore.mount();
});

onBeforeUnmount(() => {
  mounted = false;
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  resizeObserver?.disconnect();
  sheetPreviewStore.dispose();
});

defineExpose({ query, next, previous, clear, reveal, revealCell });
</script>

<style lang="less">
@import './SheetPreview.less';
</style>
