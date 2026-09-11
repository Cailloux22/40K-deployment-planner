/**
 * RT_11 / RT_18 — calcul des indicateurs et statuts de déploiement.
 *
 * Fonctions pures : elles ne lisent que les enregistrements déjà chargés
 * depuis le stockage local (RT_06/RT_08) et n'effectuent aucun appel réseau
 * (EX_05). Les écrans les rappellent à chaque affichage pour refléter les
 * sauvegardes les plus récentes.
 */

import {
  ArmyList,
  ArmyUnit,
  BoardDeploymentStatus,
  Deployment,
  DispositionIndicator,
  Placement,
  UnitModelGroup,
  UnitPlacementStatus,
} from '../models/domain.models';

/** RT_04: identité d'un modèle précis — `<groupe>#<rang>`. */
export function modelId(group: UnitModelGroup, index: number): string {
  return `${group.id}#${index}`;
}

/** Les identifiants des `count` modèles d'un groupe de socles. */
export function modelIdsOfGroup(group: UnitModelGroup): string[] {
  return Array.from({ length: group.count }, (_, i) => modelId(group, i));
}

export function modelIdsOfUnit(unit: ArmyUnit): string[] {
  return unit.modelGroups.flatMap((group) => modelIdsOfGroup(group));
}

/** Le groupe de socles auquel appartient un modèle placé. */
export function groupIdOfModel(idModele: string): string {
  return idModele.split('#')[0];
}

/**
 * RT_04: nombre de modèles distincts placés pour une unité. On compte des
 * `idModele` distincts — repositionner un modèle déjà posé ne l'ajoute pas
 * une seconde fois.
 */
export function placedModelIds(placements: readonly Placement[], unitId: string): Set<string> {
  const placed = new Set<string>();
  for (const placement of placements) {
    if (placement.idUnite === unitId) placed.add(placement.idModele);
  }
  return placed;
}

/**
 * RG_05: une unité dont tous les modèles ne sont pas placés reste « en
 * attente de déploiement ».
 */
export function isUnitFullyPlaced(unit: ArmyUnit, placements: readonly Placement[]): boolean {
  return placedModelIds(placements, unit.id).size >= unit.modelCount;
}

/**
 * RG_12/RG_14: un déploiement est « terminé » lorsque toutes les unités de la
 * liste ont tous leurs modèles placés.
 */
export function isDeploymentComplete(list: ArmyList, deployment: Deployment): boolean {
  return list.units.every((unit) => isUnitFullyPlaced(unit, deployment.placements));
}

/**
 * RG_14 / RT_11 (étape 2) — statut individuel du triplet (liste, disposition
 * adverse, plateau) :
 * rouge = aucun placement enregistré, orange = commencé mais non fini,
 * vert = toutes les unités complètes.
 */
export function boardStatus(
  list: ArmyList,
  deployment: Deployment | undefined,
): BoardDeploymentStatus {
  // « Aucun placement enregistré pour ce triplet » : un déploiement ouvert
  // puis quitté sans rien poser reste donc rouge, comme s'il n'existait pas.
  if (!deployment || deployment.placements.length === 0) return 'missing';
  return isDeploymentComplete(list, deployment) ? 'done' : 'unfinished';
}

/**
 * RG_12 / RT_11 (étape 1) — indicateur agrégé d'une disposition adverse sur
 * ses 3 plateaux. Ordre de priorité imposé par RG_12 :
 * Orange > Vert > Jaune > Blanc.
 */
/**
 * RG_24 — second canal de l'indicateur agrégé de RG_12.
 *
 * Le compte « terminés sur total » est ce que le bouton de disposition affiche
 * à côté de sa couleur ; `unfinished` alimente la mention « à reprendre », qui
 * n'est pas déductible du seul compte (un déploiement commencé mais non
 * terminé ne compte pas comme terminé et ne se distinguerait sinon pas de
 * l'état blanc ou jaune).
 */
export interface DispositionCounts {
  readonly finished: number;
  readonly unfinished: number;
  readonly total: number;
}

export function dispositionCounts(
  list: ArmyList,
  deploymentsOnPair: readonly Deployment[],
  boardCount = 3,
): DispositionCounts {
  let finished = 0;
  let unfinished = 0;
  for (const deployment of deploymentsOnPair) {
    if (deployment.placements.length === 0) continue;
    if (isDeploymentComplete(list, deployment)) finished += 1;
    else unfinished += 1;
  }
  return { finished, unfinished, total: boardCount };
}

export function dispositionIndicator(
  list: ArmyList,
  deploymentsOnPair: readonly Deployment[],
  boardCount = 3,
): DispositionIndicator {
  const { finished, unfinished } = dispositionCounts(list, deploymentsOnPair, boardCount);

  // Orange d'abord : un travail interrompu est le signal le plus utile au
  // joueur, même si d'autres plateaux du couple sont terminés.
  if (unfinished > 0) return 'orange';
  if (finished >= boardCount) return 'green';
  if (finished > 0) return 'yellow';
  return 'white';
}

// ---------------------------------------------------------------------------
// RT_18 — regroupement par socle et statut du menu unités (RG_16)
// ---------------------------------------------------------------------------

export interface UnitBaseGroupView {
  readonly group: UnitModelGroup;
  readonly total: number;
  readonly placed: number;
}

export interface UnitMenuView {
  readonly unit: ArmyUnit;
  readonly groups: readonly UnitBaseGroupView[];
  readonly placedCount: number;
  readonly status: UnitPlacementStatus;
}

/**
 * RT_18: pour une unité, regroupe ses modèles par socle et compte, pour
 * chaque groupe, ceux déjà placés — en filtrant les placements par
 * identifiant d'unité puis en croisant chaque modèle placé avec son groupe.
 *
 * Le statut global de l'unité (RG_16) en découle : blanc si aucun modèle
 * placé, vert si tous le sont, orange sinon.
 */
export function unitMenuView(unit: ArmyUnit, placements: readonly Placement[]): UnitMenuView {
  const placed = placedModelIds(placements, unit.id);

  const placedPerGroup = new Map<string, number>();
  for (const id of placed) {
    const groupId = groupIdOfModel(id);
    placedPerGroup.set(groupId, (placedPerGroup.get(groupId) ?? 0) + 1);
  }

  const groups = unit.modelGroups.map((group) => ({
    group,
    total: group.count,
    // Un groupe ne peut pas afficher plus de modèles placés qu'il n'en a.
    placed: Math.min(placedPerGroup.get(group.id) ?? 0, group.count),
  }));

  const placedCount = groups.reduce((sum, g) => sum + g.placed, 0);
  const status: UnitPlacementStatus =
    placedCount === 0 ? 'white' : placedCount >= unit.modelCount ? 'green' : 'orange';

  return { unit, groups, placedCount, status };
}

/** RG_16: le menu burger liste toutes les unités de la liste déployée. */
export function unitMenuViews(
  list: ArmyList,
  placements: readonly Placement[],
): readonly UnitMenuView[] {
  return list.units.map((unit) => unitMenuView(unit, placements));
}
