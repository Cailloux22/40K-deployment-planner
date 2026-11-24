import { BaseShape } from '../models/referential.models';
import { RANGE_RING_RADII, ovalOffsetPolygon, rangeRingOutline } from './range-ring';

const shape = (kind: BaseShape['shape'], widthMm: number, lengthMm: number): BaseShape => ({
  id: 'test',
  shape: kind,
  widthMm,
  lengthMm,
  flying: false,
  label: 'test',
});

/** Distance d'un point à l'ellipse de demi-axes a, b, par échantillonnage dense. */
function distanceToEllipse(p: { x: number; y: number }, a: number, b: number): number {
  let best = Infinity;
  const samples = 20000;
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    best = Math.min(best, Math.hypot(p.x - a * Math.cos(t), p.y - b * Math.sin(t)));
  }
  return best;
}

describe('range ring outline (RG_61, RT_80)', () => {
  it('offers 3", 6", 8", 9" and 12" in ascending order', () => {
    expect([...RANGE_RING_RADII]).toEqual([3, 6, 8, 9, 12]);
  });

  it('gives a 196.4 mm circle for a 44 mm base at 3"', () => {
    // 1 px d'asset par mm : le diamètre se lit directement en millimètres.
    const outline = rangeRingOutline(shape('round', 44, 44), 3, 1);
    expect(outline.kind).toBe('circle');
    if (outline.kind === 'circle') expect(outline.r * 2).toBeCloseTo(196.4, 9);
  });

  it('scales with the board pixels per millimetre', () => {
    const outline = rangeRingOutline(shape('round', 32, 32), 6, 1.007);
    if (outline.kind !== 'circle') throw new Error('expected a circle');
    expect(outline.r).toBeCloseTo((16 + 6 * 25.4) * 1.007, 9);
  });

  it('grows a rectangle by X on every side with corners rounded to X', () => {
    const outline = rangeRingOutline(shape('rectangle', 60, 100), 3, 1);
    if (outline.kind !== 'rect') throw new Error('expected a rectangle');
    expect(outline.x).toBeCloseTo(-30 - 76.2, 9);
    expect(outline.y).toBeCloseTo(-50 - 76.2, 9);
    expect(outline.width).toBeCloseTo(60 + 2 * 76.2, 9);
    expect(outline.height).toBeCloseTo(100 + 2 * 76.2, 9);
    expect(outline.r).toBeCloseTo(76.2, 9);
  });

  it('draws an oval ring as a closed path', () => {
    const outline = rangeRingOutline(shape('oval', 70, 105), 6, 1);
    expect(outline.kind).toBe('path');
    if (outline.kind === 'path') {
      expect(outline.d.startsWith('M')).toBe(true);
      expect(outline.d.endsWith('Z')).toBe(true);
    }
  });
});

describe('oval offset polygon (RT_80)', () => {
  const a = 35;
  const b = 52.5;
  const offset = 3 * 25.4;
  const tolerance = 0.254;
  const points = ovalOffsetPolygon(a, b, offset, tolerance);

  it('puts every vertex at exactly X from the ellipse', () => {
    for (const point of points.filter((_, i) => i % 16 === 0)) {
      expect(distanceToEllipse(point, a, b)).toBeCloseTo(offset, 2);
    }
  });

  it('keeps every chord within the 0.01" tolerance of the true curve', () => {
    for (let i = 0; i < points.length; i += 8) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      expect(offset - distanceToEllipse(mid, a, b)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('is not an ellipse with enlarged axes (RG_61)', () => {
    // Au bout du grand axe, la courbe est à X du bord : b + X sur l'axe vertical.
    const top = points.reduce((best, p) => (p.y > best.y ? p : best));
    expect(top.y).toBeCloseTo(b + offset, 6);
    // Au paramètre 45°, une ellipse aux axes agrandis passerait plus près du bord.
    const t = Math.PI / 4;
    const enlarged = { x: (a + offset) * Math.cos(t), y: (b + offset) * Math.sin(t) };
    expect(distanceToEllipse(enlarged, a, b)).toBeLessThan(offset - 0.5);
  });
});
