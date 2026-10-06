/**
 * RT_68 — règles pures du protocole de synchronisation, isolées du réseau et
 * du stockage pour être testées seules : conversion entre enregistrements
 * locaux et enregistrements du contrat, application d'une page de pull,
 * découpage d'une poussée.
 */

import { ArmyList, ArmyUnit, Deployment } from '../models/domain.models';
import {
  Deletion,
  SyncPullResult,
  SyncPushRequest,
  WireArmyList,
  WireDeployment,
} from '../models/sync.models';

/** RT_69: une poussée compte au plus 200 enregistrements et 5 Mo. */
export const PUSH_MAX_RECORDS = 200;
export const PUSH_MAX_BYTES = 5 * 1024 * 1024;
/** RT_68: taille d'une page de pull (défaut du contrat). */
export const PULL_PAGE_SIZE = 200;

/** Trace locale d'une suppression à pousser (RT_15/RT_68). */
export interface TombstoneLike {
  readonly id: string;
  readonly resourceType: 'list' | 'deployment';
  readonly deletedAt: string;
  /** RT_68: jeton de la version supprimée, `null` si jamais synchronisée. */
  readonly versionToken?: string | null;
  /** Liste d'un déploiement supprimé, pour garder une liste et ses déploiements dans la même poussée. */
  readonly listId?: string;
}

// ---------------------------------------------------------------------------
// Conversion local ↔ contrat
// ---------------------------------------------------------------------------

/**
 * RT_68: seuls les champs du contrat partent au serveur. `dirty` (RT_15) est
 * un état d'appareil ; `unresolvedReason` (RG_02) un libellé d'affichage local.
 */
function wireUnits(units: readonly ArmyUnit[]): ArmyUnit[] {
  return units.map((unit) => ({
    ...unit,
    modelGroups: unit.modelGroups.map(({ unresolvedReason: _reason, ...group }) => group),
  }));
}

export function toWireList(list: ArmyList): WireArmyList {
  return {
    id: list.id,
    name: list.name,
    forceDispositionId: list.forceDispositionId,
    units: wireUnits(list.units),
    importedAt: list.importedAt,
    updatedAt: list.updatedAt,
    // RT_68: jeton de base, absent (null) pour une création.
    versionToken: list.versionToken,
  };
}

export function toWireDeployment(deployment: Deployment): WireDeployment {
  return {
    id: deployment.id,
    name: deployment.name,
    listId: deployment.listId,
    opponentDispositionId: deployment.opponentDispositionId,
    boardId: deployment.boardId,
    placements: deployment.placements,
    reservedUnitIds: deployment.reservedUnitIds ?? [],
    note: deployment.note ?? '',
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
    versionToken: deployment.versionToken,
  };
}

/** Enregistrement serveur → enregistrement local synchronisé (RT_15). */
export function fromWireList(wire: WireArmyList, versionToken?: string | null): ArmyList {
  return {
    id: wire.id,
    name: wire.name,
    forceDispositionId: wire.forceDispositionId,
    units: wire.units.map((unit) => ({
      ...unit,
      modelGroups: unit.modelGroups.map((group) => ({ ...group, baseShapeId: group.baseShapeId ?? null })),
    })),
    importedAt: wire.importedAt ?? wire.updatedAt,
    updatedAt: wire.updatedAt,
    versionToken: versionToken ?? wire.versionToken ?? null,
    dirty: false,
  };
}

export function fromWireDeployment(wire: WireDeployment, versionToken?: string | null): Deployment {
  return {
    id: wire.id,
    name: wire.name,
    listId: wire.listId,
    opponentDispositionId: wire.opponentDispositionId,
    boardId: wire.boardId,
    placements: wire.placements.map((p) => ({ ...p })),
    reservedUnitIds: [...(wire.reservedUnitIds ?? [])],
    // RT_60: un enregistrement reçu sans note est lu comme une note vide.
    note: wire.note ?? '',
    createdAt: wire.createdAt ?? wire.updatedAt,
    updatedAt: wire.updatedAt,
    versionToken: versionToken ?? wire.versionToken ?? null,
    dirty: false,
  };
}

/** Sérialisation stable : clés triées, champs `null`/absents ignorés. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * RT_68: même contenu, jeton de version mis à part. Sert à reconnaître, dans
 * un pull, une écriture de cet appareil dont la réponse de poussée a été
 * perdue : l'enregistrement local est encore marqué modifié, mais le serveur
 * porte déjà exactement ce contenu.
 */
export function sameContent(a: WireArmyList | WireDeployment, b: WireArmyList | WireDeployment): boolean {
  const strip = (r: WireArmyList | WireDeployment) => ({ ...r, versionToken: undefined });
  return canonical(strip(a)) === canonical(strip(b));
}

// ---------------------------------------------------------------------------
// Pull (RT_68)
// ---------------------------------------------------------------------------

export interface LocalSnapshot {
  readonly lists: readonly ArmyList[];
  readonly deployments: readonly Deployment[];
  /** Identifiants supprimés localement et pas encore poussés. */
  readonly tombstoneIds: ReadonlySet<string>;
}

export interface PullPagePlan {
  /** Enregistrements à écrire localement, marqués synchronisés. */
  readonly lists: readonly ArmyList[];
  readonly deployments: readonly Deployment[];
  readonly deletedListIds: readonly string[];
  readonly deletedDeploymentIds: readonly string[];
}

/**
 * RT_15/RT_68: ce qu'une page de pull change localement.
 *
 * - Un enregistrement modifié localement n'est jamais écrasé : il part au push
 *   suivant, qui produira le conflit (RG_54) — sauf s'il porte exactement le
 *   contenu reçu (écriture de cet appareil déjà acceptée), auquel cas il est
 *   simplement marqué synchronisé avec le jeton reçu.
 * - Un enregistrement supprimé localement et pas encore poussé n'est pas
 *   ressuscité : sa suppression part au push suivant.
 * - Une liste supprimée sur le serveur n'est pas supprimée localement tant
 *   qu'elle, ou l'un de ses déploiements, y est modifié : elle attend le
 *   conflit « liste supprimée, déploiement modifié ». Sinon, ses déploiements
 *   locaux partent avec elle (RG_21).
 */
export function planPullPage(page: SyncPullResult, local: LocalSnapshot): PullPagePlan {
  const localLists = new Map(local.lists.map((l) => [l.id, l]));
  const localDeployments = new Map(local.deployments.map((d) => [d.id, d]));

  const lists: ArmyList[] = [];
  for (const wire of page.lists) {
    if (local.tombstoneIds.has(wire.id)) continue;
    const current = localLists.get(wire.id);
    if (current?.dirty && !sameContent(toWireList(current), wire)) continue;
    lists.push(fromWireList(wire));
  }

  const deployments: Deployment[] = [];
  for (const wire of page.deployments) {
    // Un déploiement d'une liste supprimée ici n'est pas écrit en orphelin :
    // la poussée produira le conflit « liste supprimée ici » (RG_54), dont la
    // résolution le renverra s'il doit être gardé.
    if (local.tombstoneIds.has(wire.id) || local.tombstoneIds.has(wire.listId)) continue;
    const current = localDeployments.get(wire.id);
    if (current?.dirty && !sameContent(toWireDeployment(current), wire)) continue;
    deployments.push(fromWireDeployment(wire));
  }

  const deletedDeploymentIds = new Set(
    page.deletedDeploymentIds.filter((id) => !localDeployments.get(id)?.dirty),
  );
  const deletedListIds: string[] = [];
  for (const listId of page.deletedListIds) {
    if (localLists.get(listId)?.dirty) continue;
    const ofList = local.deployments.filter((d) => d.listId === listId);
    if (ofList.some((d) => d.dirty)) continue;
    deletedListIds.push(listId);
    for (const d of ofList) deletedDeploymentIds.add(d.id);
  }

  return { lists, deployments, deletedListIds, deletedDeploymentIds: [...deletedDeploymentIds] };
}

// ---------------------------------------------------------------------------
// Push (RT_68)
// ---------------------------------------------------------------------------

/** Un groupe indivisible : une liste et ses déploiements restent dans la même requête. */
interface PushGroup {
  lists: WireArmyList[];
  deployments: WireDeployment[];
  deletions: Deletion[];
}

function groupSize(group: PushGroup): number {
  return group.lists.length + group.deployments.length + group.deletions.length;
}

function byteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return typeof TextEncoder === 'undefined' ? json.length * 3 : new TextEncoder().encode(json).length;
}

/**
 * RT_68: découpe la poussée en requêtes d'au plus 200 enregistrements et
 * 5 Mo, une liste et ses déploiements (écrits ou supprimés) restant dans la
 * même requête. Un groupe qui dépasse seul ces bornes part dans sa propre
 * requête : le serveur le refusera (413), sans empêcher les autres.
 */
export function buildPushBatches(
  since: string,
  lists: readonly ArmyList[],
  deployments: readonly Deployment[],
  tombstones: readonly TombstoneLike[],
  limits = { records: PUSH_MAX_RECORDS, bytes: PUSH_MAX_BYTES },
): SyncPushRequest[] {
  const groups = new Map<string, PushGroup>();
  const groupOf = (key: string): PushGroup => {
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { lists: [], deployments: [], deletions: [] }));
    return group;
  };

  for (const list of lists) groupOf(list.id).lists.push(toWireList(list));
  for (const deployment of deployments) groupOf(deployment.listId).deployments.push(toWireDeployment(deployment));
  for (const t of tombstones) {
    const key = t.resourceType === 'list' ? t.id : (t.listId ?? `deployment:${t.id}`);
    groupOf(key).deletions.push({
      resourceType: t.resourceType,
      id: t.id,
      versionToken: t.versionToken ?? null,
      deletedAt: t.deletedAt,
    });
  }

  const batches: SyncPushRequest[] = [];
  let current: PushGroup = { lists: [], deployments: [], deletions: [] };
  let currentBytes = 0;
  const flush = () => {
    if (groupSize(current) === 0) return;
    batches.push({ since, ...current });
    current = { lists: [], deployments: [], deletions: [] };
    currentBytes = 0;
  };

  for (const group of groups.values()) {
    const bytes = byteLength(group);
    if (
      groupSize(current) + groupSize(group) > limits.records ||
      currentBytes + bytes > limits.bytes
    ) {
      flush();
    }
    current.lists.push(...group.lists);
    current.deployments.push(...group.deployments);
    current.deletions.push(...group.deletions);
    currentBytes += bytes;
  }
  flush();
  return batches;
}

/** Empreinte courte d'un corps de requête (cyrb53), pour réutiliser sa clé d'idempotence. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * UUID v4. `crypto.randomUUID` n'existe que dans un contexte sécurisé : une
 * page servie en HTTP sur le réseau local (`ionic serve --external`) n'y a
 * pas accès, alors que `getRandomValues` reste disponible.
 */
export function uuid(): string {
  const native = globalThis.crypto?.randomUUID?.();
  if (native) return native;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
