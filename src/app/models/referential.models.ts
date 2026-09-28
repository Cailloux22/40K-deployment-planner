/**
 * Types des référentiels statiques embarqués avec l'application.
 *
 * RT_02 (socles) et RT_12 (plateaux) sont générés hors-ligne par les scripts
 * `scripts/ingest-*.mjs` ; RT_23 (dispositions) est écrit à la main. Aucun
 * d'entre eux n'est chargé par appel réseau à l'exécution (EX_05).
 */

/** RT_20: attribution requise par la source d'un référentiel généré. */
export interface ReferentialSource {
  readonly name: string;
  readonly attribution: string;
  readonly url: string;
  readonly via?: string;
  readonly files?: readonly string[];
}

// ---------------------------------------------------------------------------
// RT_02 — référentiel unité -> socle
// ---------------------------------------------------------------------------

// RT_26: le rectangle vient s'ajouter à round/oval — un gabarit recherché
// pour un modèle « Use model » n'est le plus souvent pas un socle ovale mais
// l'emprise rectangulaire d'une coque de véhicule.
export type BaseShapeKind = 'round' | 'oval' | 'rectangle';

/** RT_02/RT_05: forme et dimensions réelles d'un socle, en millimètres. */
export interface BaseShape {
  readonly id: string;
  readonly shape: BaseShapeKind;
  /** Petit axe pour un ovale, diamètre pour un socle rond. */
  readonly widthMm: number;
  /** Grand axe pour un ovale, diamètre pour un socle rond. */
  readonly lengthMm: number;
  readonly flying: boolean;
  /** Libellé d'origine de l'export (ex. « 120 x 92mm flying base »). */
  readonly label: string;
}

/**
 * RG_02/RT_02: socle applicable à une partie seulement des modèles d'une
 * ligne, dérivé à l'ingestion de la note en texte libre `base_size_descr`
 * (ex. « Gun servitors 32mm », « 60 x 35mm if equipped with transuranic
 * arquebus »). Les termes sont déjà normalisés et réduits à leur radical par
 * le script d'ingestion : ils se comparent tels quels à ceux d'un profil
 * importé.
 */
export interface ReferentialBaseVariant {
  readonly baseShapeId: string;
  readonly rawBaseSize: string;
  /** Désignation du modèle concerné : tous ces termes doivent apparaître. */
  readonly subject: readonly string[];
  /** Équipement déclencheur : une alternative suffit, tous ses termes requis. */
  readonly conditions: readonly (readonly string[])[];
  /** Note d'origine, citée au joueur. */
  readonly raw: string;
}

/** Un profil de modèle d'une datasheet, avec le socle qui lui est associé. */
export interface ReferentialModelLine {
  readonly name: string;
  /** Nom normalisé, clé de rapprochement avec un nom importé (RG_02). */
  readonly key: string;
  /** `null` quand l'export ne porte pas de socle exploitable (RG_02). */
  readonly baseShapeId: string | null;
  readonly rawBaseSize: string;
  readonly baseSizeNote?: string;
  /** Exceptions au socle par défaut, issues de `baseSizeNote`. */
  readonly baseVariants?: readonly ReferentialBaseVariant[];
  /**
   * Note présente mais non traduisible en exception exploitable : le socle
   * par défaut ne peut pas être appliqué en confiance, la ligne part en
   * assignation manuelle (RG_02).
   */
  readonly baseNoteUnresolved?: boolean;
}

export interface ReferentialDatasheet {
  readonly name: string;
  readonly key: string;
  readonly models: readonly ReferentialModelLine[];
}

export interface BaseReferential {
  readonly source: ReferentialSource;
  readonly generatedAt: string;
  readonly stats: {
    readonly datasheets: number;
    readonly modelLines: number;
    readonly resolvedModelLines: number;
    readonly baseShapes: number;
    readonly orphanModelLines: number;
    readonly notedModelLines: number;
    readonly variantModelLines: number;
    readonly unparsedBaseNotes: readonly string[];
    readonly ambiguousNames: readonly string[];
  };
  readonly baseShapes: readonly BaseShape[];
  readonly datasheets: readonly ReferentialDatasheet[];
}

// ---------------------------------------------------------------------------
// RT_26 — référentiel complémentaire des gabarits « Use model »
// ---------------------------------------------------------------------------

/**
 * RT_26: gabarit recherché manuellement pour une ligne de [[RT_02]] dont
 * `base_size` vaut `Use model` (aucun socle indépendant publié). Contrairement
 * aux entrées de `bases.json`, la forme n'est pas présumée ovale : elle est
 * établie au cas par cas (`round`, `oval` ou `rectangle`) à partir de ce que la
 * recherche donne à voir de la silhouette réelle du modèle.
 */
export interface UseModelFootprint {
  /** `<clé de la datasheet>::<clé de la ligne de modèle>` (RG_02). */
  readonly key: string;
  readonly shape: BaseShapeKind;
  readonly widthMm: number;
  readonly lengthMm: number;
  /** D'où vient la mesure (page produit, contenu de boîte, mesure tierce...). */
  readonly sourceNote: string;
}

/**
 * Contrairement à [[BaseReferential]]/[[BoardReferential]], ce référentiel
 * n'est pas généré par un script consommant un export structuré unique : il
 * est constitué manuellement, entrée par entrée (RT_26), et ne porte donc pas
 * de `ReferentialSource` unique à attribuer (RT_20) — chaque entrée cite sa
 * propre source via `sourceNote`.
 */
export interface UseModelFootprintReferential {
  readonly generatedAt: string;
  readonly footprints: readonly UseModelFootprint[];
}

// ---------------------------------------------------------------------------
// RT_23 — référentiel des 5 dispositions de force
// ---------------------------------------------------------------------------

/** Icône vectorielle d'une disposition, rendue sans dépendance externe. */
export interface DispositionIcon {
  readonly viewBox: string;
  readonly mode: 'fill' | 'stroke';
  readonly paths: readonly string[];
}

export interface ForceDisposition {
  readonly id: string;
  /** Clé de rapprochement avec les noms d'assets du référentiel RT_12. */
  readonly slug: string;
  readonly label: string;
  /** Libellés tels qu'ils apparaissent dans un roster importé (RT_13). */
  readonly importNames: readonly string[];
  readonly icon: DispositionIcon;
}

export interface DispositionReferential {
  readonly dispositions: readonly ForceDisposition[];
}

// ---------------------------------------------------------------------------
// RT_12 — référentiel des plateaux
// ---------------------------------------------------------------------------

export type BoardVariant = 'no-measurements' | 'with-measurements';

/**
 * RT_05: rectangle du plateau à l'intérieur de l'image du référentiel. Les
 * assets portent aussi un bandeau de titre et une légende : les coordonnées
 * de placement (RT_04) et la taille des tokens se rapportent à ce rectangle,
 * pas à l'image entière.
 */
export interface BoardPlayArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface Board {
  readonly id: string;
  /** Couple de dispositions non ordonné, normalisé (RT_12). */
  readonly pairKey: string;
  readonly dispositions: readonly [string, string];
  readonly mirror: boolean;
  /** 1, 2 ou 3 — le rang du plateau dans le pager de RG_14. */
  readonly index: number;
  readonly sourceFileName: string;
  readonly width: number;
  readonly height: number;
  readonly playArea: BoardPlayArea;
  readonly assets: Readonly<Record<BoardVariant, string>>;
}

export interface BoardReferential {
  readonly source: ReferentialSource;
  readonly generatedAt: string;
  /** RT_19: dimensions communes à tous les assets du référentiel. */
  readonly assetSize: { readonly width: number; readonly height: number };
  /** RT_05: dimensions physiques du plateau représenté, en pouces. */
  readonly boardInches: { readonly width: number; readonly height: number };
  readonly variants: readonly BoardVariant[];
  readonly boards: readonly Board[];
}

// ---------------------------------------------------------------------------
// RT_37 — référentiel des zones de terrain par plateau
// ---------------------------------------------------------------------------

/** Un polygone de terrain, en pixels d'asset (RT_04/RT_05). */
export interface TerrainPolygon {
  readonly id: string;
  readonly points: readonly (readonly [number, number])[];
}

/**
 * RG_28/RT_37: le terrain d'un plateau. Toutes les zones sont des socles de
 * ruine, donc obscurcissantes ; les murs bloquent la vue sans exception.
 */
export interface BoardTerrain {
  readonly zones: readonly TerrainPolygon[];
  readonly walls: readonly TerrainPolygon[];
}

export interface TerrainReferential {
  readonly source: ReferentialSource;
  readonly generatedAt: string;
  readonly stats: { readonly boards: number; readonly zones: number; readonly walls: number };
  /** Indexé par identifiant de plateau ; un plateau absent a un terrain non décrit. */
  readonly boards: Readonly<Record<string, BoardTerrain>>;
}
