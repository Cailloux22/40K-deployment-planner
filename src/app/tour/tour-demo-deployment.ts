import { ArmyUnit, Placement } from '../models/domain.models';
import { BaseShape, Board } from '../models/referential.models';
import { DeploymentGroup, deploymentGroups } from '../deployment/attachments';
import { ClusterMember, clusterLayout } from '../deployment/cluster';
import { modelIdsOfGroup } from '../deployment/deployment-status';
import { MM_PER_INCH, resolveGroupShape } from '../deployment/token-geometry';

/**
 * RG_65/RT_84 — déploiement d'exemple de la visite guidée.
 *
 * Fonction pure : à partir de la liste d'exemple et du plateau, elle pose
 * toutes les unités sauf une, chacune en grappe compacte (RT_41) — donc en
 * cohésion par construction (RG_26) —, les grappes rangées par rangées depuis
 * le bas du rectangle de jeu. Le calcul est déterministe : la même liste sur
 * le même plateau donne toujours les mêmes positions.
 */

/** RT_84: marge laissée entre le bord du rectangle de jeu et les grappes. */
const MARGIN_INCHES = 1;
/** RT_84: écart entre deux grappes voisines, pour distinguer les unités. */
const GAP_INCHES = 1;

export interface DemoDeploymentInput {
  readonly units: readonly ArmyUnit[];
  readonly shapes: ReadonlyMap<string, BaseShape>;
  readonly board: Board;
  /** RT_05: pixels d'asset par millimètre réel. */
  readonly pixelsPerMm: number;
}

export interface DemoDeployment {
  readonly placements: Placement[];
  /** RG_65: le groupe de déploiement laissé dans le bandeau. */
  readonly pendingGroup: DeploymentGroup;
}

/**
 * RG_65/RT_84: le groupe laissé dans le bandeau — la dernière unité
 * indépendante de la liste (sans personnage attaché), à défaut le dernier
 * groupe. La visite la met en réserve à l'étape 38.
 */
export function pendingDemoGroup(groups: readonly DeploymentGroup[]): DeploymentGroup | undefined {
  return [...groups].reverse().find((group) => group.units.length === 1) ?? groups[groups.length - 1];
}

interface PackedCluster {
  readonly offsets: Map<string, { x: number; y: number }>;
  readonly unitOf: Map<string, string>;
  /** Demi-étendues de la grappe autour de son centre, en pouces. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function clusterOf(group: DeploymentGroup, shapes: ReadonlyMap<string, BaseShape>): PackedCluster | null {
  const members: ClusterMember[] = [];
  const unitOf = new Map<string, string>();
  const radiusOf = new Map<string, number>();
  for (const unit of group.units) {
    for (const modelGroup of unit.modelGroups) {
      const shape = resolveGroupShape(modelGroup, shapes);
      // Un socle inconnu ne peut pas être posé : la grappe n'est pas formée.
      if (!shape) return null;
      for (const id of modelIdsOfGroup(modelGroup)) {
        const width = shape.widthMm / MM_PER_INCH;
        const length = shape.lengthMm / MM_PER_INCH;
        members.push({ id, shape: shape.shape, width, length });
        unitOf.set(id, unit.id);
        radiusOf.set(id, Math.max(width, length) / 2);
      }
    }
  }
  const offsets = clusterLayout(members);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (const [id, offset] of offsets) {
    const radius = radiusOf.get(id) ?? 0;
    left = Math.max(left, radius - offset.x);
    right = Math.max(right, offset.x + radius);
    top = Math.max(top, radius - offset.y);
    bottom = Math.max(bottom, offset.y + radius);
  }
  return { offsets, unitOf, left, right, top, bottom };
}

/** RG_65/RT_84: placements du déploiement d'exemple et groupe laissé dans le bandeau. */
export function demoDeployment(input: DemoDeploymentInput): DemoDeployment | null {
  const groups = deploymentGroups(input.units);
  const pendingGroup = pendingDemoGroup(groups);
  if (!pendingGroup) return null;

  const pxPerInch = input.pixelsPerMm * MM_PER_INCH;
  const area = input.board.playArea;
  const minX = area.left / pxPerInch + MARGIN_INCHES;
  const maxX = area.right / pxPerInch - MARGIN_INCHES;
  const minY = area.top / pxPerInch + MARGIN_INCHES;

  const placements: Placement[] = [];
  // Rangées successives, de bas en haut, de gauche à droite (en pouces).
  let rowBottom = area.bottom / pxPerInch - MARGIN_INCHES;
  let rowHeight = 0;
  let cursorX = minX;

  for (const group of groups) {
    if (group.id === pendingGroup.id) continue;
    const cluster = clusterOf(group, input.shapes);
    if (!cluster) return null;
    const width = cluster.left + cluster.right;
    const height = cluster.top + cluster.bottom;
    if (cursorX + width > maxX && cursorX > minX) {
      rowBottom -= rowHeight + GAP_INCHES;
      rowHeight = 0;
      cursorX = minX;
    }
    const centerX = cursorX + cluster.left;
    const centerY = Math.max(minY + cluster.top, rowBottom - cluster.bottom);
    for (const [id, offset] of cluster.offsets) {
      placements.push({
        idUnite: cluster.unitOf.get(id)!,
        idModele: id,
        x: (centerX + offset.x) * pxPerInch,
        y: (centerY + offset.y) * pxPerInch,
        rotation: 0,
      });
    }
    cursorX += width + GAP_INCHES;
    rowHeight = Math.max(rowHeight, height);
  }
  return { placements, pendingGroup };
}
