import { BoardPlayArea, BoardTerrain, TerrainPolygon } from '../models/referential.models';
import { BaseFootprint, Point, pointInPolygon } from './geometry';
import { prepareTerrain, visibleZone, visibleZonePath } from './visibility';

// Plateau d'essai de 1000 x 1000 px, à 1 px par millimètre.
const PLAY_AREA: BoardPlayArea = { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 };

function box(id: string, x0: number, y0: number, x1: number, y1: number): TerrainPolygon {
  return { id, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}

function round(x: number, y: number, diameter: number): BaseFootprint {
  return { x, y, rotation: 0, shape: 'round', width: diameter, length: diameter };
}

function zoneFrom(base: BaseFootprint, terrain: BoardTerrain): Point[][] {
  return visibleZone(base, prepareTerrain(terrain, PLAY_AREA, 1));
}

/** Un point est vu s'il est dans l'un des polygones de la zone visible. */
function sees(zone: readonly Point[][], point: Point): boolean {
  return zone.some((polygon) => pointInPolygon(point, polygon));
}

const ZONE = box('z', 400, 400, 600, 600);

describe('RG_27/RT_38 — zone visible depuis un socle', () => {
  it('voit tout le plateau quand il n’y a aucun obstacle', () => {
    const zone = zoneFrom(round(500, 500, 32), { zones: [], walls: [] });
    for (const corner of [[5, 5], [995, 5], [995, 995], [5, 995]] as Point[]) {
      expect(sees(zone, corner)).toBe(true);
    }
  });

  it('voit plus loin autour d’un obstacle avec un grand socle qu’avec un petit', () => {
    const terrain: BoardTerrain = { zones: [ZONE], walls: [] };
    const target: Point = [650, 900];
    // Seul un socle qui déborde à droite de la zone voit ce point derrière elle.
    expect(sees(zoneFrom(round(480, 200, 10), terrain), target)).toBe(false);
    expect(sees(zoneFrom(round(480, 200, 260), terrain), target)).toBe(true);
  });
});

describe('RG_28/RT_38 — terrain obscurcissant', () => {
  const terrain: BoardTerrain = { zones: [ZONE], walls: [] };
  const base = round(500, 200, 32);

  it('ne voit pas ce qui est derrière une zone', () => {
    expect(sees(zoneFrom(base, terrain), [500, 800])).toBe(false);
  });

  it('voit l’intérieur de la zone qui lui fait face', () => {
    expect(sees(zoneFrom(base, terrain), [500, 450])).toBe(true);
    expect(sees(zoneFrom(base, terrain), [500, 590])).toBe(true);
  });

  it('ne voit pas l’intérieur d’une zone cachée derrière une autre', () => {
    const two: BoardTerrain = { zones: [box('a', 400, 400, 600, 500), box('b', 400, 550, 600, 650)], walls: [] };
    expect(sees(zoneFrom(base, two), [500, 600])).toBe(false);
  });

  it('voit à travers la zone dans laquelle son socle se trouve', () => {
    // Le socle chevauche le bord supérieur de la zone.
    expect(sees(zoneFrom(round(500, 405, 32), terrain), [500, 800])).toBe(true);
  });

  it('continue de voir ce qui est à côté de la zone', () => {
    expect(sees(zoneFrom(base, terrain), [150, 800])).toBe(true);
  });
});

describe('RG_28/RT_38 — murs', () => {
  const wall = box('w', 400, 495, 600, 505);
  const terrain: BoardTerrain = { zones: [ZONE], walls: [wall] };

  it('bloque la vue même depuis l’intérieur de la ruine', () => {
    const inside = round(500, 450, 32);
    expect(sees(zoneFrom(inside, terrain), [500, 470])).toBe(true);
    expect(sees(zoneFrom(inside, terrain), [500, 560])).toBe(false);
  });

  it('bloque la vue sur un plateau sans zone', () => {
    const lone: BoardTerrain = { zones: [], walls: [wall] };
    expect(sees(zoneFrom(round(500, 300, 32), lone), [500, 800])).toBe(false);
  });
});

describe('RG_27/RT_38 — largeur de 1 mm', () => {
  const base = round(200, 500, 4);
  const target: Point = [800, 500];

  it('ne passe pas par un interstice de moins de 1 mm entre deux zones', () => {
    const gap = 0.8;
    const terrain: BoardTerrain = {
      zones: [box('a', 400, 0, 600, 500 - gap / 2), box('b', 400, 500 + gap / 2, 600, 1000)],
      walls: [],
    };
    expect(sees(zoneFrom(base, terrain), target)).toBe(false);
  });

  it('passe par un interstice de plus de 1 mm', () => {
    const gap = 1.5;
    const terrain: BoardTerrain = {
      zones: [box('a', 400, 0, 600, 500 - gap / 2), box('b', 400, 500 + gap / 2, 600, 1000)],
      walls: [],
    };
    expect(sees(zoneFrom(base, terrain), target)).toBe(true);
  });
});

describe('RT_39 — chemin SVG de la zone visible', () => {
  it('produit un sous-chemin fermé par polygone', () => {
    const path = visibleZonePath([
      [[0, 0], [10, 0], [10, 10]],
      [[20, 20], [30, 20], [30, 30]],
    ]);
    expect(path).toBe('M0.0 0.0L10.0 0.0L10.0 10.0ZM20.0 20.0L30.0 20.0L30.0 30.0Z');
  });
});
