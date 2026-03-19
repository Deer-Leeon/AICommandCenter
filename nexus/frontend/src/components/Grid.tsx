import { useDroppable } from '@dnd-kit/core';
import { useStore } from '../store/useStore';
import { DEFAULT_SEARCH_BAR_CONFIG } from '../types';

export const ROWS = 2;
export const COLS = 6;

// Bar dimensions — must match WidgetCanvas.tsx
const BAR_H       = 54;
const BAR_MARGIN  = 8;   // gap between bar edge and nearest widget row
const GRID_PAD    = 16;
// Reserve space so the bottom-positioned search bar + its drag handle sit above the PageNavBar pill
const PAGE_NAV_BAR_RESERVE = 70;

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
}

function DropCell({ row, col, colSpan, rowSpan, onOpenPicker, notchCols, notch }: DropCellProps) {
  const key = `${row},${col}`;
  const { grid } = useStore();
  const isOccupied = !!grid[key];
  const { isOver, setNodeRef } = useDroppable({ id: key });

  function handleClick() {
    if (!isOccupied) onOpenPicker(row, col);
  }

  // Mirror the notch applied in WidgetCanvas.computeRects so empty cells
  // match the shorter height of occupied cells in center columns.
  const spansNotch   = Array.from({ length: colSpan }, (_, i) => col + i).some(c => notchCols.has(c));
  const inNotchCol   = spansNotch && rowSpan === 1;
  const marginTop    = inNotchCol && row === 1 ? notch : 0;
  const marginBottom = inNotchCol && row === 0 ? notch : 0;

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

  // Only apply notch when the bar sits between the two widget rows
  const notchCols = cfg.position === 'middle'
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();
  const notch = cfg.position === 'middle' ? 30 : 0;

  // When bar is at top/bottom, push the grid inward so widgets don't collide.
  // Bottom also reserves space for the PageNavBar so the bar's drag handle stays reachable.
  const extraTopPad    = cfg.position === 'top'    ? BAR_H + BAR_MARGIN : 0;
  const extraBottomPad = cfg.position === 'bottom' ? BAR_H + BAR_MARGIN + PAGE_NAV_BAR_RESERVE : 0;

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
        />
      );
    }
  }

  return (
    <div
      id="nexus-grid"
      className="absolute inset-0"
      style={{
        paddingTop:    GRID_PAD + extraTopPad,
        paddingBottom: GRID_PAD + extraBottomPad,
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
