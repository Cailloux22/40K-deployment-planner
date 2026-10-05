/**
 * Modèle de données métier — listes d'armée importées et déploiements
 * sauvegardés. Ces types sont le contrat partagé entre la persistance locale
 * (RT_08), la synchronisation (RT_09, cf. `specification/openapi.yml`) et les
 * écrans.
 */

/**
 * RG_16/RT_18: un groupe de modèles d'une unité partageant le même socle.
 *
 * Une unité importée n'a pas forcément un socle unique : le récapitulatif
 * d'import (RG_22) et le menu unités (RG_16) présentent ses socles regroupés
 * par forme/taille avec un compte. Un groupe porte donc son propre
 * `baseShapeId`, et `null` tant que le joueur ne l'a pas assigné (RG_02).
 */
export interface UnitModelGroup {
  readonly id: string;
  /** Nom du profil de modèle tel qu'importé (RT_13). */
  readonly name: string;
  readonly count: number;
  /** `null` = non résolu par le référentiel, assignation manuelle due (RG_02). */
  baseShapeId: string | null;
  /** Libellé brut du socle non résolu, affiché pour expliquer le défaut. */
  readonly unresolvedReason?: string;
  /**
   * RG_02/RT_28: socle rectangulaire sur mesure, saisi à la main par le joueur
   * en dernier recours quand aucun socle du référentiel ne convient.
   * Mutuellement exclusif avec `baseShapeId` (l'un des deux est renseigné,
   * jamais les deux) — propre à ce groupe de cette liste, jamais mémorisé
   * ailleurs ni reversé au référentiel partagé [[RT_26]].
   */
  customRectangleMm?: { widthMm: number; lengthMm: number };
}

/** RG_36: rôle d'un personnage attaché — meneur (*leader*) ou soutien (*support*). */
export type AttachmentRole = 'leader' | 'support';

/**
 * RG_36/RT_45: attachement d'un personnage à l'unité qu'il escorte. Porté par
 * le seul personnage : la composition de l'unité escortée s'en dérive, ce qui
 * exclut deux descriptions divergentes du même lien.
 */
export interface UnitAttachment {
  readonly bodyguardUnitId: string;
  readonly role: AttachmentRole;
}

/** RG_02/RT_13: une unité de la liste importée. */
export interface ArmyUnit {
  readonly id: string;
  readonly name: string;
  /** Somme des `count` de `modelGroups` (RT_13). */
  readonly modelCount: number;
  readonly modelGroups: readonly UnitModelGroup[];
  /** RG_06: couleur partagée par tous les tokens de l'unité. */
  color: string;
  /**
   * RG_36/RT_45: unité escortée par ce personnage, et son rôle. Absent pour
   * une unité indépendante, et sur toute liste importée avant RG_36.
   */
  readonly attachment?: UnitAttachment;
}

/** RG_01/RT_07: une liste d'armée importée, ancre stable des déploiements. */
export interface ArmyList {
  readonly id: string;
  /** Pré-rempli depuis `roster.name`, éditable au récapitulatif (RG_22). */
  name: string;
  /** RG_02/RG_03: disposition du joueur, fixée dès l'import. */
  readonly forceDispositionId: string;
  readonly units: readonly ArmyUnit[];
  readonly importedAt: string;
  updatedAt: string;
  /** RT_15: jeton de la dernière synchronisation réussie, `null` si jamais. */
  versionToken: string | null;
  /** RT_15: l'enregistrement a été modifié localement depuis ce jeton. */
  dirty: boolean;
}

/** RG_04/RT_04: un placement = un modèle, jamais une unité entière. */
export interface Placement {
  readonly idUnite: string;
  /** Identité d'un modèle précis au sein de l'unité (`groupe#rang`). */
  readonly idModele: string;
  /** Coordonnées dans le repère de l'image de plateau (RT_12/RT_19). */
  x: number;
  y: number;
  /** RG_20/RT_22: rotation en degrés, indépendante de x/y. */
  rotation: number;
}

/** RG_07: un déploiement sauvegardé, lié à sa liste par `listId` (RT_07). */
export interface Deployment {
  readonly id: string;
  name: string;
  /** RT_07: identifiant stable de la liste, jamais son contenu. */
  readonly listId: string;
  readonly opponentDispositionId: string;
  readonly boardId: string;
  placements: Placement[];
  /**
   * RG_25/RT_35: unités déclarées « en réserve » sur ce déploiement —
   * déployées au sens de RG_05 sans aucun token sur le plateau. Propre au
   * déploiement, jamais à la liste : la même unité peut être en réserve sur
   * un plateau et posée sur un autre. Normalisé à `[]` à la lecture d'un
   * enregistrement écrit avant RT_35.
   */
  reservedUnitIds: string[];
  /**
   * RG_45/RT_60: note de plan de jeu, texte brut, `""` quand il n'y en a pas.
   * N'entre dans aucun statut, et « Nouveau » (RG_14) la conserve. Normalisée
   * à `""` à la lecture d'un enregistrement écrit avant EX_13.
   */
  note: string;
  readonly createdAt: string;
  updatedAt: string;
  versionToken: string | null;
  dirty: boolean;
}

/** RG_14: statut individuel d'un plateau à l'étape 2 du parcours RG_03. */
export type BoardDeploymentStatus = 'missing' | 'unfinished' | 'done';

/** RG_12: indicateur agrégé sur les 3 plateaux d'une disposition adverse. */
export type DispositionIndicator = 'white' | 'yellow' | 'orange' | 'green';

/** RG_16: état de placement d'une unité dans le menu unités. */
export type UnitPlacementStatus = 'white' | 'orange' | 'green';
