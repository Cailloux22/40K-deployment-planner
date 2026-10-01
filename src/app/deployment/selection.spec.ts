import { BaseFootprint } from './geometry';
import { idsTouchedByRect, isDoubleTap, rectTouchesBase } from './selection';

const round = (x: number, y: number): BaseFootprint => ({
  x,
  y,
  rotation: 0,
  shape: 'round',
  width: 20,
  length: 20,
});

describe('selection (RG_30, RT_40)', () => {
  it('selects a base only partly covered by the rectangle', () => {
    expect(rectTouchesBase({ x1: 0, y1: 0, x2: 95, y2: 100 }, round(100, 50))).toBe(true);
  });

  it('ignores a base outside the rectangle, whichever way the corners are given', () => {
    expect(rectTouchesBase({ x1: 80, y1: 80, x2: 0, y2: 0 }, round(100, 50))).toBe(false);
    expect(rectTouchesBase({ x1: 80, y1: 80, x2: 0, y2: 0 }, round(40, 40))).toBe(true);
  });

  it('selects a base that fully contains the rectangle', () => {
    expect(rectTouchesBase({ x1: 98, y1: 48, x2: 102, y2: 52 }, round(100, 50))).toBe(true);
  });

  it('uses the base outline, not its centre', () => {
    const wide: BaseFootprint = { x: 100, y: 100, rotation: 90, shape: 'rectangle', width: 100, length: 10 };
    // Rotated 90°: the base spans y 50..150 and x 95..105.
    expect(rectTouchesBase({ x1: 90, y1: 140, x2: 110, y2: 160 }, wide)).toBe(true);
    expect(rectTouchesBase({ x1: 140, y1: 95, x2: 160, y2: 105 }, wide)).toBe(false);
  });

  it('returns the ids of the touched bases only', () => {
    const items = [
      { id: 'a', base: round(10, 10) },
      { id: 'b', base: round(200, 200) },
    ];
    expect(idsTouchedByRect(items, { x1: 0, y1: 0, x2: 30, y2: 30 })).toEqual(['a']);
  });

  it('detects a double tap on the same token only', () => {
    const first = { id: 'a', time: 1000, x: 10, y: 10 };
    expect(isDoubleTap(first, { id: 'a', time: 1200, x: 12, y: 11 })).toBe(true);
    expect(isDoubleTap(first, { id: 'b', time: 1200, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap(first, { id: 'a', time: 1400, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap(first, { id: 'a', time: 1100, x: 40, y: 10 })).toBe(false);
    expect(isDoubleTap(null, first)).toBe(false);
  });
});
