import { ArmyUnit, UnitModelGroup } from '../models/domain.models';
import { autoUnitColor } from './unit-colors';

/**
 * RG_40/RT_50 — scission d'une unité en deux au récapitulatif d'import.
 *
 * Calcul pur, sans dépendance à l'interface : la répartition par défaut, les
 * dépôts du glisser-déposer, la validité d'une scission et sa
 * matérialisation en deux unités à l'enregistrement (RT_52).
 */

/** RG_40: effectif minimal d'une unité pour qu'elle puisse être scindée. */
export const SPLIT_MIN_UNIT_MODELS = 10;

/** RG_40: effectif minimal de chaque moitié pour que la liste soit enregistrable. */
export const SPLIT_MIN_HALF_MODELS = 5;

export type SplitHalf = 0 | 1;

/** Effectif de chaque groupe de modèles (`UnitModelGroup.id`) dans une moitié. */
export type HalfCounts = Readonly<Record<string, number>>;

/** RT_50: scission en cours, état du récapitulatif — jamais persisté. */
export interface UnitSplitDraft {
  readonly unitId: string;
  readonly halves: readonly [HalfCounts, HalfCounts];
  /** Moitié qui reçoit les personnages attachés (RG_36). */
  readonly bodyguardHalf: SplitHalf;
}

/** RG_40: moitié dont l'effectif est sous le minimum. */
export interface SplitError {
  readonly half: SplitHalf;
  readonly count: number;
}

export function otherHalf(half: SplitHalf): SplitHalf {
  return half === 0 ? 1 : 0;
}

export function halfModelCount(split: UnitSplitDraft, half: SplitHalf): number {
  return Object.values(split.halves[half]).reduce((sum, count) => sum + count, 0);
}

/**
 * RG_40/RT_50: une unité se scinde si elle compte au moins 10 modèles —
 * `modelCount` exclut déjà les personnages attachés, qui sont des unités à
 * part — et n'est pas elle-même un personnage attaché à une autre unité.
 */
export function canSplit(unit: ArmyUnit): boolean {
  return unit.modelCount >= SPLIT_MIN_UNIT_MODELS && !unit.attachment;
}

/**
 * RG_40/RT_50: répartition par défaut. Les groupes sont parcourus dans
 * l'ordre ; la part arrondie au supérieur de chacun va à la moitié la moins
 * nombreuse à ce stade (la première en cas d'égalité). L'écart entre les
 * moitiés ne dépasse jamais 1, donc chacune reçoit au moins 5 modèles.
 */
export function defaultSplit(unit: ArmyUnit): UnitSplitDraft {
  const halves: [Record<string, number>, Record<string, number>] = [{}, {}];
  const totals = [0, 0];
  for (const group of unit.modelGroups) {
    const larger = Math.ceil(group.count / 2);
    const first: SplitHalf = totals[1] < totals[0] ? 1 : 0;
    const second = otherHalf(first);
    halves[first][group.id] = larger;
    halves[second][group.id] = group.count - larger;
    totals[first] += larger;
    totals[second] += group.count - larger;
  }
  return { unitId: unit.id, halves, bodyguardHalf: 0 };
}

function withCounts(split: UnitSplitDraft, half: SplitHalf, counts: HalfCounts): UnitSplitDraft {
  const halves: [HalfCounts, HalfCounts] = [split.halves[0], split.halves[1]];
  halves[half] = counts;
  return { ...split, halves };
}

function shift(counts: HalfCounts, groupId: string, delta: number): HalfCounts {
  return { ...counts, [groupId]: (counts[groupId] ?? 0) + delta };
}

/**
 * RG_40/RT_50: un modèle du groupe passe de `from` à l'autre moitié. Le dépôt
 * n'est jamais refusé pour cause d'effectif — une moitié peut descendre sous
 * 5, voire à 0 ; seul un groupe absent de la moitié de départ laisse la
 * répartition inchangée.
 */
export function moveModel(split: UnitSplitDraft, groupId: string, from: SplitHalf): UnitSplitDraft {
  if ((split.halves[from][groupId] ?? 0) < 1) return split;
  const to = otherHalf(from);
  const moved = withCounts(split, from, shift(split.halves[from], groupId, -1));
  return withCounts(moved, to, shift(moved.halves[to], groupId, 1));
}

/**
 * RG_40/RT_50: échange un modèle du groupe `groupId` de la moitié `from` avec
 * un modèle du groupe `otherGroupId` de l'autre moitié. Les effectifs ne
 * changent pas, seule la composition change.
 */
export function swapModels(
  split: UnitSplitDraft,
  groupId: string,
  otherGroupId: string,
  from: SplitHalf,
): UnitSplitDraft {
  const to = otherHalf(from);
  if (groupId === otherGroupId) return split;
  if ((split.halves[from][groupId] ?? 0) < 1 || (split.halves[to][otherGroupId] ?? 0) < 1) return split;
  const there = moveModel(split, groupId, from);
  return moveModel(there, otherGroupId, to);
}

/** RG_40/RT_50: moitiés sous le minimum de 5 ; vide quand la scission est valide. */
export function splitErrors(split: UnitSplitDraft): SplitError[] {
  return ([0, 1] as const)
    .map((half) => ({ half, count: halfModelCount(split, half) }))
    .filter((entry) => entry.count < SPLIT_MIN_HALF_MODELS);
}

/** RG_40: libellé d'une moitié, repris dans le nom de l'unité enregistrée. */
export function halfName(unitName: string, half: SplitHalf): string {
  return `${unitName} (${half + 1})`;
}

/**
 * RG_06/RT_52: couleur de la seconde moitié de chaque scission — une couleur
 * automatique distincte de celles déjà portées par les unités de la liste et
 * des secondes moitiés précédentes. La première moitié garde la couleur de
 * l'unité d'origine.
 */
export function secondHalfColors(
  units: readonly ArmyUnit[],
  splits: readonly UnitSplitDraft[],
): ReadonlyMap<string, string> {
  const used = new Set(units.map((unit) => unit.color));
  const colors = new Map<string, string>();
  let index = 0;
  for (const split of splits) {
    while (used.has(autoUnitColor(index))) index++;
    const color = autoUnitColor(index);
    used.add(color);
    colors.set(split.unitId, color);
  }
  return colors;
}

/**
 * RT_52: à l'enregistrement, chaque scission remplace son unité d'origine par
 * deux `ArmyUnit` ordinaires, à sa position dans la liste. Rien ne relie
 * ensuite les deux unités entre elles ni à l'unité d'origine.
 */
export function applySplits(
  units: readonly ArmyUnit[],
  splits: readonly UnitSplitDraft[],
  newUnitId: () => string,
): ArmyUnit[] {
  const colors = secondHalfColors(units, splits);
  const splitByUnit = new Map(splits.map((split) => [split.unitId, split]));
  // RT_45: identifiant de la moitié qui reprend les personnages attachés.
  const bodyguardIdOf = new Map<string, string>();

  const result = units.flatMap((unit) => {
    const split = splitByUnit.get(unit.id);
    if (!split) return [unit];
    const halves = ([0, 1] as const).map((half) => {
      const id = newUnitId();
      const modelGroups: UnitModelGroup[] = unit.modelGroups
        .filter((group) => (split.halves[half][group.id] ?? 0) > 0)
        .map((group, index) => ({
          ...group,
          id: `${id}_g${index}`,
          count: split.halves[half][group.id],
        }));
      return {
        ...unit,
        id,
        // RG_40: nom d'origine suivi de « (1) » ou « (2) ».
        name: halfName(unit.name, half),
        modelCount: modelGroups.reduce((sum, group) => sum + group.count, 0),
        modelGroups,
        // RG_06: la première moitié garde la couleur d'origine.
        color: half === 0 ? unit.color : (colors.get(unit.id) ?? unit.color),
      } satisfies ArmyUnit;
    });
    bodyguardIdOf.set(unit.id, halves[split.bodyguardHalf].id);
    return halves;
  });

  // RT_45: les personnages qui escortaient l'unité d'origine suivent la moitié
  // désignée par `bodyguardHalf`.
  return result.map((unit) => {
    const target = unit.attachment && bodyguardIdOf.get(unit.attachment.bodyguardUnitId);
    return target ? { ...unit, attachment: { ...unit.attachment!, bodyguardUnitId: target } } : unit;
  });
}
