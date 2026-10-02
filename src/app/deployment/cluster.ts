/**
 * RT_41 — formation de la grappe compacte d'une saisie groupée (RG_32).
 *
 * Fonction pure, en pouces réels (comme RT_36) : la grappe ne dépend ni de
 * l'affichage ni du plateau. L'appelant convertit les décalages obtenus dans
 * le repère de l'asset (RT_04/RT_05).
 *
 * Tous les socles étant à rotation nulle (RG_32), contact et chevauchement se
 * décident par les fonctions de support des formes — demi-étendue du socle
 * projeté sur une direction — sans construire de polygone : la formation d'une
 * unité de 20 ovales reste ainsi instantanée à la saisie.
 */

import { BaseShapeKind } from '../models/referential.models';

/** Un socle à disposer, en pouces réels. */
export interface ClusterMember {
  readonly id: string;
  readonly shape: BaseShapeKind;
  readonly width: number;
  readonly length: number;
}

interface PlacedMember extends ClusterMember {
  readonly x: number;
  readonly y: number;
}

/** RT_41: écart visé entre deux socles jointifs — 0,5 mm. */
export const CLUSTER_GAP_INCHES = 0.5 / 25.4;
/** RT_41: directions essayées autour de chaque socle déjà placé. */
const DIRECTIONS = 24;
/** Axes de séparation essayés entre deux socles, en plus de la ligne des centres. */
const SEPARATING_AXES = Array.from({ length: 12 }, (_, k) => {
  const angle = (Math.PI * k) / 12;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * RT_41: demi-étendue du socle, à rotation nulle, projeté sur la direction
 * unitaire (ux, uy) — exacte pour le cercle, l'ellipse et le rectangle.
 */
function support(member: ClusterMember, ux: number, uy: number): number {
  const a = member.width / 2;
  const b = member.length / 2;
  if (member.shape === 'rectangle') return a * Math.abs(ux) + b * Math.abs(uy);
  return Math.hypot(a * ux, b * uy);
}

function circumradius(member: ClusterMember): number {
  return member.shape === 'rectangle'
    ? Math.hypot(member.width, member.length) / 2
    : Math.max(member.width, member.length) / 2;
}

/**
 * RT_41: deux socles sont-ils séparés d'au moins `gap` le long d'un axe ? Un
 * tel axe garantit l'absence de chevauchement ; n'en trouver aucun parmi ceux
 * essayés écarte la position, ce qui ne peut qu'espacer la grappe.
 */
function separated(a: PlacedMember, b: PlacedMember, gap: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const centers = Math.hypot(dx, dy);
  if (centers >= circumradius(a) + circumradius(b) + gap) return true;
  const axes = centers > 0 ? [[dx / centers, dy / centers] as const, ...SEPARATING_AXES] : SEPARATING_AXES;
  return axes.some(([ux, uy]) => Math.abs(dx * ux + dy * uy) >= support(a, ux, uy) + support(b, ux, uy) + gap);
}

/**
 * RG_32/RT_41: décalage de chaque socle par rapport au centre de la grappe, en
 * pouces. Les plus grands socles au centre, les suivants jointifs autour, au
 * plus près du premier socle placé.
 */
export function clusterLayout(members: readonly ClusterMember[]): Map<string, { x: number; y: number }> {
  // RT_41: plus grande dimension décroissante, ordre d'entrée à égalité.
  const order = members
    .map((member, index) => ({ member, index }))
    .sort(
      (a, b) =>
        Math.max(b.member.width, b.member.length) - Math.max(a.member.width, a.member.length) ||
        a.index - b.index,
    )
    .map((entry) => entry.member);

  const placed: PlacedMember[] = [];
  for (const member of order) {
    if (placed.length === 0) {
      placed.push({ ...member, x: 0, y: 0 });
      continue;
    }
    // RT_41: la grappe s'enroule autour du premier socle, le plus grand — un
    // centre de gravité mobile la ferait dériver du côté des petits socles.
    let best: PlacedMember | null = null;
    let bestScore = Infinity;
    for (const anchor of placed) {
      for (let k = 0; k < DIRECTIONS; k += 1) {
        const angle = (2 * Math.PI * k) / DIRECTIONS;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        // RT_41: au contact à 0,5 mm près le long de la direction — exact
        // pour deux socles ronds, les fonctions de support étant constantes.
        const t = support(anchor, ux, uy) + support(member, ux, uy) + CLUSTER_GAP_INCHES;
        const candidate = { ...member, x: anchor.x + ux * t, y: anchor.y + uy * t };
        const score = Math.hypot(candidate.x, candidate.y);
        if (score >= bestScore - 1e-9) continue;
        if (!placed.every((other) => other === anchor || separated(other, candidate, CLUSTER_GAP_INCHES / 2))) {
          continue;
        }
        best = candidate;
        bestScore = score;
      }
    }
    // Une position libre existe toujours en bordure de la grappe : le repli
    // ne sert qu'au typage.
    placed.push(best ?? { ...member, x: 0, y: 0 });
  }

  // RT_41: recentrage sur le rectangle englobant — rotation nulle, donc la
  // largeur porte sur x et la longueur sur y.
  const left = Math.min(...placed.map((base) => base.x - base.width / 2));
  const right = Math.max(...placed.map((base) => base.x + base.width / 2));
  const top = Math.min(...placed.map((base) => base.y - base.length / 2));
  const bottom = Math.max(...placed.map((base) => base.y + base.length / 2));
  const ox = (left + right) / 2;
  const oy = (top + bottom) / 2;
  return new Map(placed.map((base) => [base.id, { x: base.x - ox, y: base.y - oy }]));
}
