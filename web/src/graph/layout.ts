export interface Point {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 120;

/** Deterministic grid layout for the initial overview. No auto-layout engine yet — see ARCHITECTURE.md. */
export function gridPosition(index: number, columns = 4): Point {
  return {
    x: (index % columns) * COLUMN_WIDTH,
    y: Math.floor(index / columns) * ROW_HEIGHT,
  };
}

/** Places a newly-expanded child near its parent, offset by its index among siblings. */
export function childPosition(parent: Point, siblingIndex: number): Point {
  return {
    x: parent.x + (siblingIndex + 1) * COLUMN_WIDTH * 0.6,
    y: parent.y + ROW_HEIGHT,
  };
}
