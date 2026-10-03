import { ArmyUnit } from '../models/domain.models';
import { autoUnitColor } from './unit-colors';
import {
  UnitSplitDraft,
  applySplits,
  canSplit,
  defaultSplit,
  halfModelCount,
  moveModel,
  secondHalfColors,
  splitErrors,
  swapModels,
} from './unit-split';

function unit(id: string, groups: readonly [string, number][], extra: Partial<ArmyUnit> = {}): ArmyUnit {
  return {
    id,
    name: 'Skitarii Rangers',
    modelCount: groups.reduce((sum, [, count]) => sum + count, 0),
    modelGroups: groups.map(([name, count], index) => ({
      id: `${id}_g${index}`,
      name,
      count,
      baseShapeId: 'round-25',
    })),
    color: autoUnitColor(0),
    ...extra,
  };
}

describe('canSplit — RG_40', () => {
  it('accepte une unité d’au moins 10 modèles', () => {
    expect(canSplit(unit('u', [['Ranger', 10]]))).toBe(true);
  });

  it('refuse une unité de moins de 10 modèles', () => {
    expect(canSplit(unit('u', [['Ranger', 9]]))).toBe(false);
  });

  it('refuse un personnage attaché à une autre unité', () => {
    expect(canSplit(unit('u', [['Ranger', 10]], { attachment: { bodyguardUnitId: 'x', role: 'leader' } }))).toBe(
      false,
    );
  });
});

describe('defaultSplit — RG_40/RT_50', () => {
  it('répartit 10 modèles en 5 + 5', () => {
    const split = defaultSplit(unit('u', [['Ranger', 10]]));
    expect([halfModelCount(split, 0), halfModelCount(split, 1)]).toEqual([5, 5]);
  });

  it('donne le modèle en plus à la première moitié', () => {
    const split = defaultSplit(unit('u', [['Ranger', 11]]));
    expect([halfModelCount(split, 0), halfModelCount(split, 1)]).toEqual([6, 5]);
  });

  it('répartit chaque groupe, le modèle isolé allant à la moitié la moins nombreuse', () => {
    const split = defaultSplit(unit('u', [['Alpha', 1], ['Ranger', 9]]));
    expect(split.halves[0]).toEqual({ u_g0: 1, u_g1: 4 });
    expect(split.halves[1]).toEqual({ u_g0: 0, u_g1: 5 });
  });

  it('garde un écart d’au plus 1 entre les moitiés quelle que soit la composition', () => {
    const split = defaultSplit(unit('u', [['A', 1], ['B', 1], ['C', 3], ['D', 7]]));
    expect(Math.abs(halfModelCount(split, 0) - halfModelCount(split, 1))).toBeLessThanOrEqual(1);
    expect(splitErrors(split)).toEqual([]);
  });

  it('attache les personnages à la première moitié par défaut', () => {
    expect(defaultSplit(unit('u', [['Ranger', 10]])).bodyguardHalf).toBe(0);
  });
});

describe('moveModel / swapModels — RG_40/RT_50', () => {
  const base = unit('u', [['Alpha', 1], ['Ranger', 9]]);

  it('accepte un dépôt qui fait passer une moitié sous 5 et le signale en erreur', () => {
    const split = moveModel(defaultSplit(base), 'u_g1', 1);
    expect([halfModelCount(split, 0), halfModelCount(split, 1)]).toEqual([6, 4]);
    expect(splitErrors(split)).toEqual([{ half: 1, count: 4 }]);
  });

  it('accepte de vider complètement une moitié', () => {
    let split = defaultSplit(base);
    for (let i = 0; i < 5; i++) split = moveModel(split, 'u_g1', 1);
    expect(halfModelCount(split, 1)).toBe(0);
    expect(splitErrors(split)).toEqual([{ half: 1, count: 0 }]);
  });

  it('conserve le compte de chaque groupe', () => {
    const split = moveModel(moveModel(defaultSplit(base), 'u_g1', 0), 'u_g0', 0);
    for (const group of base.modelGroups) {
      expect((split.halves[0][group.id] ?? 0) + (split.halves[1][group.id] ?? 0)).toBe(group.count);
    }
  });

  it('laisse la répartition inchangée pour un groupe absent de la moitié de départ', () => {
    const split = defaultSplit(base);
    expect(moveModel(split, 'u_g0', 1)).toBe(split);
  });

  it('échange deux modèles sans changer les effectifs', () => {
    const split = swapModels(defaultSplit(base), 'u_g0', 'u_g1', 0);
    expect(split.halves[0]).toEqual({ u_g0: 0, u_g1: 5 });
    expect(split.halves[1]).toEqual({ u_g0: 1, u_g1: 4 });
  });

  it('ne fait rien pour un échange entre deux modèles du même groupe', () => {
    const split = defaultSplit(base);
    expect(swapModels(split, 'u_g1', 'u_g1', 0)).toBe(split);
  });
});

describe('applySplits — RT_52', () => {
  let counter = 0;
  const newId = () => `n${++counter}`;
  beforeEach(() => (counter = 0));

  it('remplace l’unité par deux unités ordinaires, à sa position', () => {
    const other = unit('o', [['Vanguard', 5]], { name: 'Vanguard', color: autoUnitColor(1) });
    const rangers = unit('u', [['Alpha', 1], ['Ranger', 9]]);
    const split = moveModel(defaultSplit(rangers), 'u_g1', 0);
    const units = applySplits([rangers, other], [split], newId);

    expect(units.map((u) => u.name)).toEqual(['Skitarii Rangers (1)', 'Skitarii Rangers (2)', 'Vanguard']);
    expect(units[0]).toMatchObject({ id: 'n1', modelCount: 4, color: rangers.color });
    expect(units[1]).toMatchObject({ id: 'n2', modelCount: 6 });
    expect(units[0].modelGroups.map((g) => [g.id, g.count])).toEqual([
      ['n1_g0', 1],
      ['n1_g1', 3],
    ]);
    // Un groupe à 0 est omis.
    expect(units[1].modelGroups.map((g) => [g.name, g.count])).toEqual([['Ranger', 6]]);
  });

  it('donne à la seconde moitié une couleur absente de la liste', () => {
    const rangers = unit('u', [['Ranger', 10]]);
    const other = unit('o', [['Vanguard', 5]], { color: autoUnitColor(1) });
    const units = applySplits([rangers, other], [defaultSplit(rangers)], newId);
    expect(units[1].color).toBe(autoUnitColor(2));
  });

  it('donne des couleurs distinctes aux secondes moitiés de plusieurs scissions', () => {
    const a = unit('a', [['Ranger', 10]]);
    const b = unit('b', [['Ranger', 10]], { color: autoUnitColor(1) });
    const colors = secondHalfColors([a, b], [defaultSplit(a), defaultSplit(b)]);
    expect(new Set([a.color, b.color, colors.get('a'), colors.get('b')]).size).toBe(4);
  });

  it('rattache les personnages à la moitié désignée', () => {
    const rangers = unit('u', [['Ranger', 10]]);
    const leader = unit('c', [['Manipulus', 1]], {
      name: 'Manipulus',
      attachment: { bodyguardUnitId: 'u', role: 'leader' },
    });
    const split: UnitSplitDraft = { ...defaultSplit(rangers), bodyguardHalf: 1 };
    const units = applySplits([rangers, leader], [split], newId);
    expect(units[2].attachment).toEqual({ bodyguardUnitId: 'n2', role: 'leader' });
  });

  it('laisse la liste inchangée sans scission', () => {
    const rangers = unit('u', [['Ranger', 10]]);
    expect(applySplits([rangers], [], newId)).toEqual([rangers]);
  });
});
