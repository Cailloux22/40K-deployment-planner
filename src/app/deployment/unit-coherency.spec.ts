import { BaseShape } from '../models/referential.models';
import { MM_PER_INCH } from './token-geometry';
import {
  CoherencyBase,
  baseGap,
  coherencyBase,
  detachedAfterRemoval,
  isCoherent,
} from './unit-coherency';

/** Socle rond de `diameter` pouces centré en (x, y) pouces. */
function round(id: string, x: number, y: number, diameter = 1): CoherencyBase {
  return { id, x, y, rotation: 0, shape: 'round', width: diameter, length: diameter };
}

function oval(id: string, x: number, y: number, width: number, length: number, rotation = 0): CoherencyBase {
  return { id, x, y, rotation, shape: 'oval', width, length };
}

function rect(id: string, x: number, y: number, width: number, length: number, rotation = 0): CoherencyBase {
  return { id, x, y, rotation, shape: 'rectangle', width, length };
}

describe('RT_36 — distance entre socles', () => {
  it('mesure bord à bord entre deux socles ronds', () => {
    expect(baseGap(round('a', 0, 0), round('b', 3, 0))).toBeCloseTo(2, 6);
  });

  it('vaut zéro pour deux socles qui se chevauchent', () => {
    expect(baseGap(round('a', 0, 0), round('b', 0.5, 0))).toBe(0);
    expect(baseGap(rect('a', 0, 0, 2, 2), rect('b', 1, 1, 2, 2))).toBe(0);
  });

  it('tient compte de l’orientation d’un ovale', () => {
    // Ovale 1"×3" : grand axe vertical, puis tourné de 90° vers le rond.
    const upright = oval('a', 0, 0, 1, 3);
    const turned = oval('a', 0, 0, 1, 3, 90);
    const target = round('b', 4, 0);
    expect(baseGap(upright, target)).toBeCloseTo(3, 1);
    expect(baseGap(turned, target)).toBeCloseTo(2, 1);
  });

  it('mesure un rectangle tourné par son coin le plus proche', () => {
    // Carré de 2" tourné de 45° : son coin s'avance de √2 depuis le centre.
    const gap = baseGap(rect('a', 0, 0, 2, 2, 45), round('b', 5, 0));
    expect(gap).toBeCloseTo(5 - Math.SQRT2 - 0.5, 3);
  });

  it('convertit un placement en pouces réels (RT_05)', () => {
    const shape: BaseShape = { id: 'r', shape: 'round', widthMm: 25.4, lengthMm: 25.4, flying: false, label: '' };
    const base = coherencyBase({ idUnite: 'u', idModele: 'g#1', x: 20, y: 40, rotation: 0 }, shape, 10 / MM_PER_INCH);
    expect(base).toMatchObject({ x: 2, y: 4, width: 1, length: 1 });
  });
});

describe('RG_26 — cohésion d’unité', () => {
  it('considère un modèle seul comme en cohésion', () => {
    expect(isCoherent([round('a', 0, 0)])).toBe(true);
  });

  it('accepte une chaîne continue à 2"', () => {
    expect(isCoherent([round('a', 0, 0), round('b', 3, 0), round('c', 6, 0)])).toBe(true);
  });

  it('accepte un modèle posé exactement au seuil, à la tolérance près', () => {
    expect(isCoherent([round('a', 0, 0), round('b', 3.005, 0)])).toBe(true);
    expect(isCoherent([round('a', 0, 0), round('b', 3.05, 0)])).toBe(false);
  });

  it('refuse deux grappes séparées de plus de 2"', () => {
    const bases = [round('a', 0, 0), round('b', 1.5, 0), round('c', 5, 0), round('d', 6.5, 0)];
    expect(isCoherent(bases)).toBe(false);
  });

  it('refuse une chaîne qui s’étire au-delà de 9"', () => {
    const chain = [0, 3, 6, 9, 12].map((x, i) => round(`m${i}`, x, 0));
    expect(isCoherent(chain)).toBe(false);
  });
});

describe('RG_26 — retrait coupant la chaîne', () => {
  it('ne retire rien si la chaîne reste continue', () => {
    expect(detachedAfterRemoval([round('a', 0, 0), round('b', 3, 0)])).toEqual([]);
  });

  it('conserve le groupe le plus nombreux', () => {
    const bases = [round('a', 0, 0), round('b', 6, 0), round('c', 7.5, 0)];
    expect(detachedAfterRemoval(bases)).toEqual(['a']);
  });

  it('conserve, à égalité, le groupe du modèle posé le plus tôt', () => {
    const bases = [round('late', 6, 0), round('first', 0, 0), round('second', 1.5, 0), round('latest', 7.5, 0)];
    // Le premier placement de la liste est « late » : son groupe est gardé.
    expect(detachedAfterRemoval(bases).sort()).toEqual(['first', 'second']);
  });
});
