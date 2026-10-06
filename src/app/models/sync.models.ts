/**
 * Types du contrat de synchronisation, alignés sur
 * `specification/openapi.yml` v1.1.0 (RT_09) — compte utilisateur (EX_06,
 * RG_10, RG_50 à RG_53, RT_67), delta (RT_09/RT_10/RT_68) et conflits
 * (RG_11/RG_54/RT_15).
 *
 * Les enregistrements « wire » sont la forme échangée avec le serveur : sans
 * l'indicateur local `dirty` (RT_15, état d'appareil jamais transmis) ni les
 * champs d'affichage propres au client.
 */

import { ArmyUnit, Placement } from './domain.models';

// ---------------------------------------------------------------------------
// Compte et appareil (RG_50, RG_52, RG_53, RT_67)
// ---------------------------------------------------------------------------

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export type DevicePlatform = 'android' | 'ios' | 'web';

/** RT_67: identité de cette installation, envoyée à l'inscription et à la connexion. */
export interface Device {
  readonly id: string;
  readonly name: string;
  readonly platform: DevicePlatform;
}

/** RG_54: auteur d'une version, tel que présenté au joueur. */
export type DeviceLabel = Device;

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly createdAt?: string;
}

/** RT_67: résultat d'une inscription ou d'une connexion. */
export interface AuthResult {
  readonly deviceToken: string;
  readonly user: AuthUser;
}

/** RT_21/RT_67: session persistée dans la configuration légère (RT_08). */
export type AuthSession = AuthResult;

/** RT_69: corps d'erreur commun à toutes les routes. */
export interface ApiErrorBody {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: readonly { field: string; message: string }[];
}

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'BATCH_TOO_LARGE'
  | 'SYNC_TOKEN_EXPIRED'
  | 'CONFLICT_STALE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CLIENT_TOO_OLD'
  | 'INTERNAL_ERROR';

// ---------------------------------------------------------------------------
// Enregistrements échangés (RT_68)
// ---------------------------------------------------------------------------

export interface WireArmyList {
  readonly id: string;
  readonly name: string;
  readonly forceDispositionId: string;
  readonly units: readonly ArmyUnit[];
  readonly importedAt?: string;
  readonly updatedAt: string;
  readonly versionToken?: string | null;
}

export interface WireDeployment {
  readonly id: string;
  readonly name: string;
  readonly listId: string;
  readonly opponentDispositionId: string;
  readonly boardId: string;
  readonly placements: readonly Placement[];
  readonly reservedUnitIds: readonly string[];
  readonly note?: string;
  readonly createdAt?: string;
  readonly updatedAt: string;
  readonly versionToken?: string | null;
}

export type WireRecord = WireArmyList | WireDeployment;

export type SyncResourceType = 'list' | 'deployment';

/** RG_51: contenu du compte, présenté avant fusion/remplacement. */
export interface SyncSummary {
  readonly listCount: number;
  readonly deploymentCount: number;
  readonly lastChangeAt: string | null;
}

export interface SyncPullResult {
  readonly lists: readonly WireArmyList[];
  readonly deployments: readonly WireDeployment[];
  readonly deletedListIds: readonly string[];
  readonly deletedDeploymentIds: readonly string[];
  readonly nextToken: string;
  readonly hasMore: boolean;
}

/** RT_68: une suppression locale, avec le jeton de la version supprimée. */
export interface Deletion {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly versionToken?: string | null;
  readonly deletedAt?: string;
}

export interface SyncPushRequest {
  readonly since: string;
  readonly lists: readonly WireArmyList[];
  readonly deployments: readonly WireDeployment[];
  readonly deletions: readonly Deletion[];
}

export interface AcceptedRecord {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly deleted: boolean;
  readonly versionToken?: string;
}

export interface RejectedRecord {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly code: 'INVALID_RECORD' | 'UNKNOWN_LIST' | 'LIST_MISMATCH';
  readonly message: string;
}

/** RG_54: les six natures de conflit. */
export type ConflictKind =
  | 'bothModified'
  | 'deletedOnServer'
  | 'deletedLocally'
  | 'listDeletedOnServer'
  | 'listDeletedLocally'
  | 'duplicateDeployment';

/** RG_11/RG_54/RT_68: la version serveur d'un enregistrement en conflit. */
export interface SyncConflict {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly kind: ConflictKind;
  /** `null` quand la version serveur est une suppression. */
  readonly serverRecord: WireRecord | null;
  readonly serverVersionToken: string;
  readonly serverUpdatedAt: string;
  readonly serverDevice: DeviceLabel;
  /** `listDeletedLocally` : déploiements serveur supprimés avec la liste. */
  readonly relatedServerRecords?: readonly WireDeployment[];
}

export interface SyncPushResult {
  readonly accepted: readonly AcceptedRecord[];
  readonly conflicts: readonly SyncConflict[];
  readonly rejected: readonly RejectedRecord[];
}

export type ConflictChoice = 'keepLocal' | 'keepServer';

export interface ConflictResolution {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly kind: ConflictKind;
  /** RG_54: le choix du joueur écrase l'autre version, jamais l'application. */
  readonly resolution: ConflictChoice;
  readonly serverVersionToken: string;
  readonly localRecord?: WireRecord;
  readonly localList?: WireArmyList;
  readonly duplicateServerDeploymentId?: string;
}

export interface RelatedRecord {
  readonly resourceType: SyncResourceType;
  readonly record: WireRecord;
  readonly versionToken: string;
}

export interface ConflictResolutionResult {
  readonly resourceType: SyncResourceType;
  readonly id: string;
  readonly deleted: boolean;
  readonly record?: WireRecord;
  readonly versionToken?: string;
  readonly relatedRecords: readonly RelatedRecord[];
  readonly relatedDeletions: readonly { resourceType: SyncResourceType; id: string }[];
}

// ---------------------------------------------------------------------------
// État côté client
// ---------------------------------------------------------------------------

/**
 * RG_09/RG_19: état de synchronisation affiché par l'écran Réglages. Jamais
 * bloquant pour l'interaction en cours.
 */
export type SyncState =
  | 'offline'
  | 'localOnly'
  | 'awaitingChoice'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'rejected'
  | 'upgradeRequired'
  | 'error';

/**
 * RG_54: la version locale d'un conflit — l'enregistrement tel qu'il est sur
 * l'appareil, ou sa suppression locale.
 */
export type LocalVersion =
  | { readonly deleted: false; readonly record: WireRecord; readonly updatedAt: string }
  | { readonly deleted: true; readonly updatedAt: string };

/** RG_11/RG_54: un conflit en attente d'arbitrage, avec les deux versions. */
export interface PendingConflict extends SyncConflict {
  readonly local: LocalVersion;
}

/** RG_51: comparaison présentée au joueur avant la première synchronisation. */
export interface FirstConnectionChoice {
  readonly email: string;
  readonly local: { readonly lists: number; readonly deployments: number };
  readonly account: SyncSummary;
}
