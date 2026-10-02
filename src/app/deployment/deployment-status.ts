/**
 * RT_11 / RT_18 / RT_35 — calcul des indicateurs et statuts de déploiement.
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
import { DeploymentGroup, deploymentGroups, singleUnitGroup } from './attachments';

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

/** Ensemble vide partagé — un déploiement sans réserve n'alloue rien. */
const NO_RESERVE: ReadonlySet<string> = new Set<string>();

/**
 * RT_35: les unités en réserve d'un déploiement, sous forme d'ensemble. Un
 * enregistrement écrit avant RT_35 n'a pas le champ : il est lu comme vide,
 * sans migration de schéma (RT_08).
 */
export function reservedUnitIds(
  deployment: Pick<Deployment, 'reservedUnitIds'> | undefined,
): ReadonlySet<string> {
  const ids = deployment?.reservedUnitIds;
  return ids?.length ? new Set(ids) : NO_RESERVE;
}

/**
 * RG_05/RG_25: une unité n'est plus « en attente de déploiement » dès lors
 * que tous ses modèles sont posés **ou** qu'elle est déclarée en réserve.
 *
 * RT_35: la réserve est une entrée distincte du calcul — aucun placement
 * n'est fabriqué pour une unité réservée, la liste des placements restant le
 * reflet exact de ce qui est posé sur le plateau (RT_04).
 */
export function isUnitDeployed(
  unit: ArmyUnit,
  placements: readonly Placement[],
  reserved: ReadonlySet<string> = NO_RESERVE,
): boolean {
  return reserved.has(unit.id) || isUnitFullyPlaced(unit, placements);
}

/**
 * RG_12/RG_14: un déploiement est « terminé » lorsque toutes les unités de la
 * liste ont tous leurs modèles placés ou sont en réserve (RG_25).
 */
export function isDeploymentComplete(list: ArmyList, deployment: Deployment): boolean {
  const reserved = reservedUnitIds(deployment);
  return list.units.every((unit) => isUnitDeployed(unit, deployment.placements, reserved));
}

/**
 * RG_14/RT_35: un déploiement « vide » — celui sur lequel le joueur n'a rien
 * décidé du tout. Une unité mise en réserve est une décision enregistrée,
 * même sans le moindre token sur le plateau.
 */
function isDeploymentEmpty(deployment: Deployment): boolean {
  return deployment.placements.length === 0 && !deployment.reservedUnitIds?.length;
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
  // RT_35: à moins qu'il ne porte une unité en réserve (RG_25) — c'est alors
  // une décision enregistrée, pas un déploiement manquant.
  if (!deployment || isDeploymentEmpty(deployment)) return 'missing';
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
    // RT_35: même critère de « vide » que boardStatus — réserve incluse.
    if (isDeploymentEmpty(deployment)) continue;
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
  /** Groupe représentatif : tous ceux qu'il réunit partagent son socle. */
  readonly group: UnitModelGroup;
  /**
   * RG_37/RG_06: couleur des composantes qui le fournissent — nulle si des
   * composantes de couleurs différentes partagent ce socle.
   */
  readonly color: string | null;
  readonly total: number;
  readonly placed: number;
}

export interface UnitMenuView {
  /** RT_46: l'unité de déploiement — unité attachée, ou unité indépendante. */
  readonly deploymentGroup: DeploymentGroup;
  readonly groups: readonly UnitBaseGroupView[];
  readonly placedCount: number;
  readonly status: UnitPlacementStatus;
  /** RG_25: unité déclarée en réserve sur ce déploiement. */
  readonly reserved: boolean;
}

/**
 * RG_37/RT_46: un groupe de déploiement est en réserve dès que l'une de ses
 * unités y figure — la liste est complétée à la prochaine écriture.
 */
export function isGroupReserved(group: DeploymentGroup, reserved: ReadonlySet<string> = NO_RESERVE): boolean {
  return group.units.some((unit) => reserved.has(unit.id));
}

/** RG_37: modèles posés d'un groupe de déploiement, toutes composantes confondues. */
export function placedCountOfGroup(group: DeploymentGroup, placements: readonly Placement[]): number {
  return group.units.reduce((sum, unit) => sum + placedModelIds(placements, unit.id).size, 0);
}

/**
 * RG_05/RG_15/RG_37: un groupe n'est plus en attente quand il est en réserve,
 * ou quand toutes ses composantes ont tous leurs modèles posés.
 */
export function isGroupDeployed(
  group: DeploymentGroup,
  placements: readonly Placement[],
  reserved: ReadonlySet<string> = NO_RESERVE,
): boolean {
  return isGroupReserved(group, reserved) || group.units.every((unit) => isUnitFullyPlaced(unit, placements));
}

/**
 * RT_18: pour un groupe de déploiement, regroupe ses modèles par socle et
 * compte, pour chaque groupe de socle, ceux déjà placés — en filtrant les
 * placements par identifiant d'unité puis en croisant chaque modèle placé
 * avec son groupe.
 *
 * RG_37: les modèles de composantes différentes qui partagent un socle du
 * référentiel sont réunis ; un rectangle sur mesure ou un socle non résolu
 * reste un groupe à part.
 *
 * Le statut global (RG_16) en découle : blanc si aucun modèle placé, vert si
 * tous le sont, orange sinon.
 */
export function groupMenuView(
  deploymentGroup: DeploymentGroup,
  placements: readonly Placement[],
  reserved: ReadonlySet<string> = NO_RESERVE,
): UnitMenuView {
  const merged = new Map<string, { group: UnitModelGroup; colors: Set<string>; total: number; placed: number }>();
  for (const unit of deploymentGroup.units) {
    const placedPerGroup = new Map<string, number>();
    for (const id of placedModelIds(placements, unit.id)) {
      const groupId = groupIdOfModel(id);
      placedPerGroup.set(groupId, (placedPerGroup.get(groupId) ?? 0) + 1);
    }
    for (const group of unit.modelGroups) {
      // Un groupe ne peut pas afficher plus de modèles placés qu'il n'en a.
      const placed = Math.min(placedPerGroup.get(group.id) ?? 0, group.count);
      const key = group.baseShapeId ?? group.id;
      const entry = merged.get(key);
      if (entry) {
        entry.colors.add(unit.color);
        entry.total += group.count;
        entry.placed += placed;
      } else {
        merged.set(key, { group, colors: new Set([unit.color]), total: group.count, placed });
      }
    }
  }

  const groups = [...merged.values()].map(({ group, colors, total, placed }) => ({
    group,
    color: colors.size === 1 ? [...colors][0] : null,
    total,
    placed,
  }));

  const placedCount = groups.reduce((sum, g) => sum + g.placed, 0);
  // RG_16/RG_25: une unité en réserve est complète au même titre qu'une unité
  // entièrement posée ; ses comptes par groupe restent, eux, ceux des modèles
  // réellement posés — c'est la mention « en réserve » qui l'explique (RG_24).
  const isReserved = isGroupReserved(deploymentGroup, reserved);
  const status: UnitPlacementStatus = isReserved
    ? 'green'
    : placedCount === 0
      ? 'white'
      : placedCount >= deploymentGroup.modelCount
        ? 'green'
        : 'orange';

  return { deploymentGroup, groups, placedCount, status, reserved: isReserved };
}

/** RT_18: vue du menu d'une unité indépendante. */
export function unitMenuView(
  unit: ArmyUnit,
  placements: readonly Placement[],
  reserved: ReadonlySet<string> = NO_RESERVE,
): UnitMenuView {
  return groupMenuView(singleUnitGroup(unit), placements, reserved);
}

/**
 * RG_16/RG_37: le menu burger liste toutes les unités de déploiement de la
 * liste — une unité attachée y est une seule entrée.
 */
export function unitMenuViews(
  list: ArmyList,
  placements: readonly Placement[],
  reserved: ReadonlySet<string> = NO_RESERVE,
): readonly UnitMenuView[] {
  return deploymentGroups(list.units).map((group) => groupMenuView(group, placements, reserved));
}
