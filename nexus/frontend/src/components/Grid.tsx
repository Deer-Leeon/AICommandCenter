import { useDroppable } from '@dnd-kit/core';
import { useStore } from '../store/useStore';

export const ROWS = 2;
export const COLS = 6;

// Must match NOTCH_COLS and NOTCH in WidgetCanvas.tsx
const NOTCH_COLS = new Set([1, 2, 3]);
const NOTCH = 30;

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
}

function DropCell({ row, col, colSpan, rowSpan, onOpenPicker }: DropCellProps) {
  const key = `${row},${col}`;
  const { grid } = useStore();
  const isOccupied = !!grid[key];
  const { isOver, setNodeRef } = useDroppable({ id: key });

  function handleClick() {
    if (!isOccupied) onOpenPicker(row, col);
  }

  // Mirror the notch applied in WidgetCanvas.computeRects so empty cells
  // match the shorter height of occupied cells in center columns.
  // Check the full column span, not just the top-left col.
  const spansNotch = Array.from({ length: colSpan }, (_, i) => col + i).some(c => NOTCH_COLS.has(c));
  const inNotchCol = spansNotch && rowSpan === 1;
  const marginTop    = inNotchCol && row === 1 ? NOTCH : 0;
  const marginBottom = inNotchCol && row === 0 ? NOTCH : 0;

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
  const { gridSpans } = useStore();
  const covered = getCoveredCells(gridSpans);

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const key = `${row},${col}`;
      if (covered.has(key)) continue; // skip — rendered as part of a merged zone
      const span = gridSpans[key] ?? { colSpan: 1, rowSpan: 1 };
      cells.push(
        <DropCell key={key} row={row} col={col} colSpan={span.colSpan} rowSpan={span.rowSpan} onOpenPicker={onOpenPicker} />
      );
    }
  }

  return (
    <div id="nexus-grid" className="absolute inset-0" style={{ padding: '16px' }}>
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
