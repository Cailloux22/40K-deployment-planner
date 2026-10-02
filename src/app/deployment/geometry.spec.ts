import { clampViewOffset, formatInches, measureInches } from './geometry';

describe('ruler measure (RG_33, RT_42)', () => {
  it('converts an asset-pixel distance to inches with the board scale', () => {
    // 1 px d'asset par mm : 254 px font 10".
    expect(measureInches({ x: 0, y: 0 }, { x: 254, y: 0 }, 1)).toBeCloseTo(10, 9);
    // Diagonale 3-4-5, à 2 px par mm.
    expect(measureInches({ x: 10, y: 10 }, { x: 10 + 3 * 50.8, y: 10 + 4 * 50.8 }, 2)).toBeCloseTo(5, 9);
  });

  it('is symmetric and zero for a single point', () => {
    const a = { x: 12, y: 40 };
    const b = { x: 300, y: 7 };
    expect(measureInches(a, b, 1.007)).toBeCloseTo(measureInches(b, a, 1.007), 12);
    expect(measureInches(a, a, 1.007)).toBe(0);
  });

  it('formats to the tenth of an inch with a decimal comma', () => {
    expect(formatInches(6.34)).toBe('6,3"');
    expect(formatInches(6.36)).toBe('6,4"');
    expect(formatInches(0)).toBe('0,0"');
    expect(formatInches(12)).toBe('12,0"');
  });
});

describe('view offset bounds (RG_38, RG_39, RT_47)', () => {
  const area = { width: 400, height: 600 };

  it('keeps a surface that fits the area centred', () => {
    expect(clampViewOffset({ dx: 50, dy: -80 }, { width: 300, height: 600 }, area)).toEqual({ dx: 0, dy: 0 });
  });

  it('lets an enlarged surface slide by at most half its overflow', () => {
    const surface = { width: 800, height: 1200 };
    expect(clampViewOffset({ dx: 120, dy: -90 }, surface, area)).toEqual({ dx: 120, dy: -90 });
    expect(clampViewOffset({ dx: 500, dy: -500 }, surface, area)).toEqual({ dx: 200, dy: -300 });
    expect(clampViewOffset({ dx: -500, dy: 500 }, surface, area)).toEqual({ dx: -200, dy: 300 });
  });

  it('bounds each axis independently', () => {
    // Plus large que la zone, mais pas plus haute : seul dx peut varier.
    expect(clampViewOffset({ dx: 90, dy: 40 }, { width: 800, height: 500 }, area)).toEqual({ dx: 90, dy: 0 });
  });
});
