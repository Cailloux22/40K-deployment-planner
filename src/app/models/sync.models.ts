/**
 * Types du contrat de synchronisation, alignés sur
 * `specification/openapi.yml` (RT_09) — compte utilisateur (EX_06, RG_10),
 * delta (RT_09/RT_10) et conflits (RG_11/RT_15).
 */

import { ArmyList, Deployment } from './domain.models';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface AuthSession extends AuthTokens {
  readonly user: AuthUser;
}

export interface SyncPullResult {
  readonly lists: readonly ArmyList[];
  readonly deployments: readonly Deployment[];
  readonly deletedListIds: readonly string[];
  readonly deletedDeploymentIds: readonly string[];
  readonly nextToken: string;
}

export interface SyncPushRequest {
  readonly since: string;
  readonly lists?: readonly ArmyList[];
  readonly deployments?: readonly Deployment[];
  readonly deletedListIds?: readonly string[];
  readonly deletedDeploymentIds?: readonly string[];
}

export type SyncResourceType = 'list' | 'deployment';

/** RG_11/RT_15: la version serveur d'un enregistrement en conflit. */
export interface SyncConflict {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly serverRecord: ArmyList | Deployment;
}

export interface SyncPushResult {
  readonly acceptedListIds: readonly string[];
  readonly acceptedDeploymentIds: readonly string[];
  readonly conflicts: readonly SyncConflict[];
  readonly nextToken: string;
}

export interface ConflictResolution {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  /** RG_11: le choix du joueur écrase l'autre version, jamais l'application. */
  readonly resolution: 'keepLocal' | 'keepServer';
  readonly localRecord?: ArmyList | Deployment;
}

export interface ConflictResolutionResult {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly record: ArmyList | Deployment;
  readonly versionToken: string;
}

/**
 * RG_09/RG_19: état de synchronisation affiché par l'écran Réglages. Jamais
 * bloquant pour l'interaction en cours.
 */
export type SyncState = 'offline' | 'localOnly' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

/** RG_11: un conflit en attente d'arbitrage, avec les deux versions. */
export interface PendingConflict extends SyncConflict {
  readonly localRecord: ArmyList | Deployment;
}
