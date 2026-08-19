export interface Point {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 120;

/** Places a newly-expanded child near its parent, offset by its index among siblings. */
export function childPosition(parent: Point, siblingIndex: number): Point {
  return {
    x: parent.x + (siblingIndex + 1) * COLUMN_WIDTH * 0.6,
    y: parent.y + ROW_HEIGHT,
  };
}
