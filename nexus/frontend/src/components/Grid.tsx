import { useDroppable } from '@dnd-kit/core';
import { useStore } from '../store/useStore';
import { DEFAULT_SEARCH_BAR_CONFIG } from '../types';

export const ROWS = 2;
export const COLS = 6;

// Bar dimensions — must match WidgetCanvas.tsx
const BAR_H       = 54;
const BAR_MARGIN  = 8;   // gap between bar edge and nearest widget row
const GRID_PAD    = 16;

/** Returns the set of cell keys that are "covered" (inside a merged zone but not the top-left). */
export function getCoveredCells(gridSpans: Record<string, { colSpan: number; rowSpan: number }>): Set<string> {
  const covered = new Set<string>();
  for (const [key, span] of Object.entries(gridSpans)) {
    const [r, c] = key.split(',').map(Number);
    for (let dr = 0; dr < span.rowSpan; dr++) {
      for (let dc = 0; dc < span.colSpan; dc++) {
        if (dr !== 0 || dc !== 0) covered.add(`${r + dr},${c + dc}`);
      }
    }
  }
  return covered;
}

interface DropCellProps {
  row: number;
  col: number;
  colSpan: number;
  rowSpan: number;
  onOpenPicker: (row: number, col: number) => void;
  notchCols: Set<number>;
  notch: number;
  barCols: Set<number>;
  barExtra: number;
  barPosition: 'top' | 'middle' | 'bottom';
}

function DropCell({ row, col, colSpan, rowSpan, onOpenPicker, notchCols, notch, barCols, barExtra, barPosition }: DropCellProps) {
  const key = `${row},${col}`;
  const { grid } = useStore();
  const isOccupied = !!grid[key];
  const { isOver, setNodeRef } = useDroppable({ id: key });

  function handleClick() {
    if (!isOccupied) onOpenPicker(row, col);
  }

  // Mirror the exact margin logic from WidgetCanvas.computeRects so empty drop
  // zones match the size and position of occupied widget cells.
  const colIndices   = Array.from({ length: colSpan }, (_, i) => col + i);
  const spansNotch   = colIndices.some(c => notchCols.has(c));
  const inNotchCol   = spansNotch && rowSpan === 1;
  let marginTop    = inNotchCol && row === 1 ? notch : 0;
  let marginBottom = inNotchCol && row === 0 ? notch : 0;

  // Top/bottom bar-column adjustment: push bar columns away from the bar edge.
  const spansBarCol = barCols.size > 0 && colIndices.some(c => barCols.has(c));
  if (spansBarCol && rowSpan === 1) {
    if (barPosition === 'top'    && row === 0)         marginTop    += barExtra;
    if (barPosition === 'bottom' && row === ROWS - 1)  marginBottom += barExtra;
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className={`nexus-drop-cell rounded-xl flex items-center justify-center${isOver ? ' nexus-drop-cell--over' : ''}`}
      style={{
        gridColumn: `${col + 1} / span ${colSpan}`,
        gridRow: `${row + 1} / span ${rowSpan}`,
        marginTop,
        marginBottom,
        opacity: isOccupied ? 0 : 1,
        pointerEvents: isOccupied ? 'none' : 'auto',
        cursor: isOccupied ? 'default' : 'pointer',
      }}
    >
      {!isOccupied && (
        <span className="nexus-drop-icon">+</span>
      )}
    </div>
  );
}

interface GridProps {
  onOpenPicker: (row: number, col: number) => void;
}

export function Grid({ onOpenPicker }: GridProps) {
  const { gridSpans, searchBarConfig } = useStore();
  const cfg = searchBarConfig ?? DEFAULT_SEARCH_BAR_CONFIG;
  const covered = getCoveredCells(gridSpans);

  // Middle mode: notch columns shortened so the bar fits between rows.
  const notchCols = cfg.position === 'middle'
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();
  const notch = cfg.position === 'middle' ? 30 : 0;

  // Top/bottom modes: only bar columns are shifted away from the bar.
  // Non-bar columns extend to the full edge — no global extra padding needed.
  const barCols  = (cfg.position === 'top' || cfg.position === 'bottom')
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();
  const barExtra = BAR_H + BAR_MARGIN;

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const key = `${row},${col}`;
      if (covered.has(key)) continue;
      const span = gridSpans[key] ?? { colSpan: 1, rowSpan: 1 };
      cells.push(
        <DropCell
          key={key} row={row} col={col}
          colSpan={span.colSpan} rowSpan={span.rowSpan}
          onOpenPicker={onOpenPicker}
          notchCols={notchCols}
          notch={notch}
          barCols={barCols}
          barExtra={barExtra}
          barPosition={cfg.position}
        />
      );
    }
  }

  return (
    <div
      id="nexus-grid"
      className="absolute inset-0"
      style={{
        paddingTop:    GRID_PAD,
        paddingBottom: GRID_PAD,
        paddingLeft:   GRID_PAD,
        paddingRight:  GRID_PAD,
      }}
    >
      <div
        className="grid h-full"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          gap: '10px',
        }}
      >
        {cells}
      </div>
    </div>
  );
}
