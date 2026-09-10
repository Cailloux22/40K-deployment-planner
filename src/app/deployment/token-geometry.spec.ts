import { BaseShape, Board, BoardReferential } from '../models/referential.models';
import { assetPixelsPerMm, clampToPlayArea, containFitScale, tokenSize } from './token-geometry';

/** Rectangle réellement mesuré sur les assets du référentiel (RT_12). */
const board: Board = {
  id: 'take-and-hold__take-and-hold__1',
  pairKey: 'take-and-hold__take-and-hold',
  dispositions: ['take-and-hold', 'take-and-hold'],
  mirror: true,
  index: 1,
  sourceFileName: 'take-and-hold-mirror-1.png',
  width: 1653,
  height: 2833,
  playArea: { left: 263, top: 753, right: 1389, bottom: 2284, width: 1127, height: 1532 },
  assets: {
    'no-measurements': 'assets/referentials/boards/no-measurements/take-and-hold-mirror-1.png',
    'with-measurements': 'assets/referentials/boards/with-measurements/take-and-hold-mirror-1.png',
  },
};

const referential = {
  assetSize: { width: 1653, height: 2833 },
  boardInches: { width: 44, height: 60 },
} as BoardReferential;

const round32: BaseShape = {
  id: 'round-32',
  shape: 'round',
  widthMm: 32,
  lengthMm: 32,
  flying: false,
  label: '32mm',
};

const oval105x70: BaseShape = {
  id: 'oval-105x70',
  shape: 'oval',
  widthMm: 70,
  lengthMm: 105,
  flying: false,
  label: '105 x 70mm',
};

describe('RT_05 — échelle des tokens', () => {
  it('déduit l’échelle du rectangle mesuré et de la taille physique du plateau', () => {
    // 1127 px pour 44" (1117,6 mm) et 1532 px pour 60" (1524 mm) : ~1,007 px/mm.
    expect(assetPixelsPerMm(board, referential)).toBeCloseTo(1.007, 2);
  });

  it('dimensionne un socle rond en cercle à son diamètre réel', () => {
    const size = tokenSize(round32, assetPixelsPerMm(board, referential));
    expect(size.width).toBeCloseTo(size.height, 6);
    expect(size.width).toBeCloseTo(32 * 1.007, 1);
  });

  it('dimensionne un socle ovale en respectant ses deux axes', () => {
    const size = tokenSize(oval105x70, assetPixelsPerMm(board, referential));
    expect(size.height / size.width).toBeCloseTo(105 / 70, 6);
  });

  it('garde deux socles proportionnellement corrects à toute échelle', () => {
    // La proportion entre deux socles ne dépend pas du zoom courant.
    for (const perMm of [0.5, 1.007, 4]) {
      const small = tokenSize(round32, perMm);
      const large = tokenSize(oval105x70, perMm);
      expect(large.width / small.width).toBeCloseTo(70 / 32, 6);
    }
  });
});

describe('RT_19 — zoom fixe d’affichage du plateau (contain-fit)', () => {
  it('retient le plus petit des deux ratios disponibles', () => {
    // Largeur limitante : 400 / 1653 < 4000 / 2833.
    expect(containFitScale({ width: 400, height: 4000 }, { width: 1653, height: 2833 })).toBeCloseTo(
      400 / 1653,
      6,
    );
    // Hauteur limitante : 800 / 2833 < 2000 / 1653.
    expect(containFitScale({ width: 2000, height: 800 }, { width: 1653, height: 2833 })).toBeCloseTo(
      800 / 2833,
      6,
    );
  });

  it('est identique pour tous les assets, qui partagent les mêmes dimensions', () => {
    const available = { width: 390, height: 700 };
    const portrait = { ...referential.assetSize };
    expect(containFitScale(available, referential.assetSize)).toBe(
      containFitScale(available, portrait),
    );
  });

  it('renvoie 0 quand aucun espace n’est encore disponible', () => {
    expect(containFitScale({ width: 0, height: 0 }, referential.assetSize)).toBe(0);
  });
});

describe('Bornes du plateau — un token ne sort pas de l’aire de jeu', () => {
  it('ramène une position hors cadre sur le bord le plus proche', () => {
    expect(clampToPlayArea(board, 0, 0)).toEqual({ x: 263, y: 753 });
    expect(clampToPlayArea(board, 9999, 9999)).toEqual({ x: 1389, y: 2284 });
  });

  it('laisse intacte une position déjà dans le cadre', () => {
    expect(clampToPlayArea(board, 800, 1500)).toEqual({ x: 800, y: 1500 });
  });
});
