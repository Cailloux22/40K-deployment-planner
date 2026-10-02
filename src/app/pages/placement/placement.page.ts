import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';

import { LibraryService } from '../../data/library.service';
import {
  UnitMenuView,
  isGroupDeployed,
  isGroupReserved,
  modelIdsOfGroup,
  placedCountOfGroup,
  placedModelIds,
  reservedUnitIds,
  unitMenuViews,
} from '../../deployment/deployment-status';
import { DeploymentGroup, componentLabel, deploymentGroups, groupIdByUnit } from '../../deployment/attachments';
import {
  assetPixelsPerMm,
  clampToPlayArea,
  MM_PER_INCH,
  containFitScale,
  resolveGroupShape,
  tokenSize,
} from '../../deployment/token-geometry';
import { clusterLayout } from '../../deployment/cluster';
import { BaseFootprint, clampViewOffset, formatInches, measureInches } from '../../deployment/geometry';
import { SelectionRect, idsTouchedByRect, isDoubleTap, soleSelectedUnit } from '../../deployment/selection';
import { CoherencyBase, coherencyBase, detachedAfterRemoval, isCoherent } from '../../deployment/unit-coherency';
import { prepareTerrain, visibilityBase, visibleZone, visibleZonePath } from '../../deployment/visibility';
import { ArmyList, ArmyUnit, Deployment, Placement, UnitModelGroup } from '../../models/domain.models';
import { BaseShape, BaseShapeKind, Board, BoardReferential, BoardTerrain } from '../../models/referential.models';
import { UNIT_COLOR_FALLBACK } from '../../import/unit-colors';
import { ReferentialService } from '../../referentials/referential.service';

/**
 * Un modèle individuel de l'unité courante restant à poser, tel que listé par
 * le bandeau (RG_15 : seuls les modèles non encore placés y figurent).
 */
interface BandModel {
  readonly idModele: string;
  /** RG_37: composante du groupe de déploiement à laquelle appartient le modèle. */
  readonly unit: ArmyUnit;
  readonly group: UnitModelGroup;
  readonly shape?: BaseShape;
  /** RG_37/RG_06: chaque composante garde sa couleur. */
  readonly color: string;
  /** RG_37/RG_24: nom accessible — composante, rôle, profil. */
  readonly label: string;
}

/** Un token posé sur le plateau, prêt à être rendu en SVG. */
interface TokenView {
  readonly placement: Placement;
  readonly color: string;
  readonly rx: number;
  readonly ry: number;
  /** RT_26: rectangle rendu comme tel plutôt qu'inscrit dans une ellipse. */
  readonly shapeKind: BaseShapeKind;
  readonly selected: boolean;
  /** RG_37/RG_24: nom accessible — composante et, pour un personnage, son rôle. */
  readonly label: string;
}

type DragKind = 'new' | 'move' | 'rotate' | 'group' | 'cluster';

/** RG_32/RT_41: un socle de la grappe, relatif à son centre, en pixels CSS. */
interface GhostMember {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shapeKind: BaseShapeKind;
  /** RG_37: couleur de la composante du socle (RG_06). */
  readonly color: string;
}

/**
 * RT_34: retour visuel d'un glisser en cours — token provisoire suivant le
 * doigt (ou le curseur) et cercle de visée annonçant où le centre du socle se
 * posera. Positionné en pixels CSS dans le repère de la mise en page, donc
 * hors du conteneur rogné du plateau (RT_19), pour rester visible tant que le
 * doigt n'a pas encore quitté le bandeau (RG_15).
 */
interface DragGhostView {
  /** Centre du socle à venir, relatif au coin haut-gauche de la mise en page. */
  readonly left: number;
  readonly top: number;
  /** Côté du carré de rendu — le plus grand du socle et du cercle de visée. */
  readonly box: number;
  /** RT_05: taille du socle à l'écran, celle qu'il aura une fois posé. */
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly shapeKind: BaseShapeKind;
  readonly color: string;
  /**
   * RT_34: le token n'est dessiné que pour un dépôt à venir ; un token déjà
   * posé suit déjà le doigt sur le plateau, seul le cercle de visée s'ajoute.
   */
  readonly withToken: boolean;
  /** RT_34: faux dès que relâcher ici ne créerait aucun placement (RT_04). */
  readonly droppable: boolean;
  /** RG_32/RT_41: socles de la grappe, au lieu du token seul. */
  readonly members?: readonly GhostMember[];
  /** RT_41: rayon du cercle englobant la grappe, en pixels CSS. */
  readonly envelope?: number;
}

/** Ce qui, du retour visuel, est figé à la saisie et ne suit pas le doigt. */
type DragGhostMetrics = Omit<DragGhostView, 'left' | 'top' | 'droppable'>;

/**
 * RT_33: côté, en pixels CSS, du carré réservé au rendu d'un socle dans le
 * bandeau de RG_15. Constante : c'est l'échelle des socles qui s'y adapte,
 * jamais la hauteur du bandeau qui suit la taille des socles.
 */
const BAND_TOKEN_BOX_PX = 48;

/**
 * RT_05/RT_33: échelle nominale des socles du bandeau, choisie pour la
 * lisibilité au doigt. Elle s'applique à toutes les unités dont le plus grand
 * socle tient dans BAND_TOKEN_BOX_PX.
 */
const BAND_PIXELS_PER_MM = 0.62;

/**
 * RT_33: hauteur totale de la rangée de modèles — le carré du socle, plus le
 * remplissage du bouton (2 px de part et d'autre) et le talon bas de la
 * rangée (2 px). Voir .model / .models dans la feuille de style.
 */
const BAND_ROW_HEIGHT_PX = BAND_TOKEN_BOX_PX + 4 + 2;

/**
 * RT_34: rayon, en pixels CSS, du cercle de visée du glisser. Choisi plus
 * grand que la surface de contact d'un doigt : au zoom fixe de RT_19 un socle
 * de 32 mm mesure une dizaine de pixels et disparaît entièrement sous le
 * doigt — c'est donc ce cercle, et non le token, qui porte le retour visuel
 * pendant un geste tactile.
 */
const DRAG_AIM_RADIUS_PX = 26;

interface DragState {
  readonly kind: DragKind;
  readonly idModele: string;
  readonly pointerId: number;
  /** Écart entre le centre du token et le doigt, en coordonnées d'asset. */
  readonly grabOffset: { x: number; y: number };
  readonly startRotation: number;
  readonly startAngle: number;
  /** Unité (composante) du modèle saisi — celle d'un placement créé (RT_04). */
  readonly idUnite: string;
  /**
   * RG_37/RT_46: groupe de déploiement du modèle saisi — celui dont la
   * cohésion est contrôlée (RG_26), toutes composantes confondues.
   */
  readonly groupId: string;
  /** RT_36: position du token posé à la saisie, rétablie si le geste est refusé. */
  readonly startPosition: { x: number; y: number };
  /**
   * RG_26: l'unité était-elle en cohésion au début du geste ? Seul un geste
   * qui ferait perdre la cohésion est refusé : sur une unité déjà hors
   * cohésion (déploiement antérieur à la règle), tout geste reste permis.
   */
  readonly wasCoherent: boolean;
  /** RT_34: métriques du retour visuel, relevées une fois pour toutes ici. */
  readonly ghost: DragGhostMetrics;
  /** RG_30/RT_40: tokens déplacés ensemble, et groupes en cohésion à la saisie. */
  readonly group?: {
    readonly ids: ReadonlySet<string>;
    readonly coherentUnits: ReadonlySet<string>;
  };
  /**
   * RG_32/RT_41: modèles du bandeau posés ensemble, avec leur décalage au
   * centre de la grappe en pixels d'asset — figé à la saisie.
   */
  readonly cluster?: readonly {
    readonly idUnite: string;
    readonly idModele: string;
    readonly dx: number;
    readonly dy: number;
  }[];
  /**
   * RG_34/RG_35: déplacement saisi en mode « Règle » — tracé de la mesure, et
   * contrôle de cohésion suspendu. Relevé à la saisie : il vaut pour tout le geste.
   */
  readonly ruler?: boolean;
}

/** RG_33/RT_42: tracé de la règle, en coordonnées d'asset (RT_04). */
interface RulerMeasure {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  /** RG_34: déplacement refusé — le segment garde la distance tentée. */
  readonly refused: boolean;
}

/** RG_33/RT_43: mesure prête à être rendue, étiquette en pixels CSS du plateau. */
interface RulerView extends RulerMeasure {
  readonly label: string;
  readonly labelLeft: number;
  readonly labelTop: number;
  /** RT_43: rayon des extrémités, en unités du viewBox (pixels d'asset). */
  readonly endRadius: number;
}

/**
 * RT_43: écart, en pixels CSS, entre le second point du segment et le centre
 * de l'étiquette — au-delà du cercle de visée (RT_34), donc hors du doigt.
 */
const RULER_LABEL_OFFSET_PX = DRAG_AIM_RADIUS_PX + 22;
/** RT_43: demi-étendue réservée à l'étiquette pour la garder dans le plateau. */
const RULER_LABEL_HALF_WIDTH_PX = 34;
const RULER_LABEL_HALF_HEIGHT_PX = 16;

/** RG_30/RT_40: tracé en cours du rectangle de sélection. */
interface MarqueeState {
  readonly pointerId: number;
  readonly start: { x: number; y: number };
  /** Maj maintenu : les tokens touchés s'ajoutent à la sélection existante. */
  readonly additive: boolean;
  readonly previous: ReadonlySet<string>;
}

/**
 * Écran 6 — Écran de placement (RG_03 étape 3).
 *
 * RG_17/RT_19: le plateau occupe la plus grande taille possible dans l'espace
 * disponible, à un zoom de base calculé par ajustement « contenir ». Ce zoom
 * n'est pas réglable librement : aucun pincer-zoomer, aucun zoom à la
 * molette. RG_38/RG_39: seuls un agrandissement unique ×2, par son bouton, et
 * le déplacement de la vue agrandie sont offerts au joueur.
 * RT_03: plateau et tokens sont rendus en SVG, pour un drag-and-drop tactile
 * précis sans perte de précision de positionnement.
 * RG_04: un token = un modèle — une unité de 10 modèles demande 10 placements.
 * EX_04/RG_07: l'état courant est sauvegardé en continu, pas en fin de saisie.
 */
@Component({
  selector: 'app-placement',
  templateUrl: 'placement.page.html',
  styleUrls: ['placement.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacementPage implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly referential = inject(ReferentialService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  /** RT_34: repère de positionnement du retour visuel du glisser. */
  @ViewChild('layout') layout?: ElementRef<HTMLElement>;
  @ViewChild('boardArea') boardArea?: ElementRef<HTMLElement>;
  @ViewChild('boardSurface') boardSurface?: ElementRef<HTMLElement>;

  private readonly listId = signal('');
  private readonly opponentId = signal('');
  private readonly boardId = signal('');
  private readonly boardReferential = signal<BoardReferential | undefined>(undefined);
  private readonly shapes = signal<ReadonlyMap<string, BaseShape>>(new Map());

  /** RT_32: repli de couleur d’unité, exposé au gabarit du bandeau. */
  readonly fallbackColor = UNIT_COLOR_FALLBACK;
  /** RT_33: hauteur réservée de la rangée de modèles, posée par le gabarit. */
  readonly bandRowHeight = BAND_ROW_HEIGHT_PX;
  /** RT_34: rayon du cercle de visée, posé par le gabarit. */
  readonly aimRadius = DRAG_AIM_RADIUS_PX;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private drag: DragState | null = null;
  private marqueeState: MarqueeState | null = null;
  /** RT_40: dernier appui sur un token, pour reconnaître un double clic (RG_31). */
  private lastTap: { id: string; time: number; x: number; y: number } | null = null;
  /** RT_41: dernier appui dans le bandeau, pour reconnaître un double appui (RG_32). */
  private lastBandTap: { id: string; time: number; x: number; y: number } | null = null;
  /** RG_33/RT_42: mesure libre en cours de tracé sur le fond du plateau. */
  private rulerDrag: { pointerId: number } | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * RG_33/RT_42: mode « Règle ». Local à l'écran, ni persisté ni synchronisé :
   * l'écran s'ouvre toujours mode désactivé.
   */
  readonly rulerMode = signal(false);
  /** RG_33/RG_34: le tracé affiché — au plus un à la fois. */
  readonly measure = signal<RulerMeasure | null>(null);
  /** RT_43: mesure annoncée aux technologies d'assistance, au relâchement seulement. */
  readonly measureAnnouncement = signal('');
  /**
   * RG_35/RT_44: groupes de déploiement en cohésion à l'activation du mode —
   * les seuls qui seront retaillés à sa sortie.
   */
  private readonly rulerCoherentUnits = signal<ReadonlySet<string>>(new Set());

  readonly board = signal<Board | undefined>(undefined);
  readonly deployment = signal<Deployment | undefined>(undefined);
  /** RG_15/RG_37: rang, parmi les groupes de déploiement, de celui du bandeau. */
  readonly selectedGroupIndex = signal(0);
  /**
   * RG_30/RT_40: tokens sélectionnés, par identifiant de modèle. Purement local
   * à l'écran : ni persisté ni synchronisé.
   */
  readonly selection = signal<ReadonlySet<string>>(new Set());
  /** RG_20/RG_29: l'unique token sélectionné ; nul si la sélection en compte 0 ou plusieurs. */
  readonly selectedPlacementId = computed<string | null>(() => {
    const ids = this.selection();
    return ids.size === 1 ? [...ids][0] : null;
  });
  /**
   * RG_32/RT_41: modèles du bandeau sélectionnés par double appui, distincts
   * des tokens posés de `selection`. Purement local à l'écran.
   */
  readonly bandSelection = signal<ReadonlySet<string>>(new Set());
  /** RT_41: la grappe de la sélection du bandeau est en cours de glisser. */
  readonly clusterGrabbed = signal(false);
  /** RG_30/RT_40: tracé du rectangle de sélection, en coordonnées d'asset. */
  readonly marquee = signal<SelectionRect | null>(null);
  /** RG_30/RT_40: déplacement provisoire du groupe, rendu seul jusqu'au relâchement. */
  private readonly groupOffset = signal<{ dx: number; dy: number } | null>(null);
  /** RG_30: relâcher ici ne déplacerait pas le groupe. */
  readonly groupRefused = signal(false);
  /** RG_16/RT_24: panneau latéral des unités, ouvert par le menu burger. */
  readonly menuOpen = signal(false);
  /** RT_19: facteur de base, recalculé sur changement d'espace disponible. */
  private readonly baseScale = signal(0);
  /**
   * RG_38/RT_47: niveau d'agrandissement — 1 (zoom de base) ou 2. Local à
   * l'écran, ni persisté ni synchronisé : l'écran s'ouvre toujours à 1.
   */
  readonly zoom = signal<1 | 2>(1);
  /** RT_47: décalage de vue de la surface, en pixels CSS, borné par `clampViewOffset`. */
  readonly viewOffset = signal<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** RG_39/RT_48: mode « Déplacement » — local, remis à faux au retour au zoom de base. */
  readonly panMode = signal(false);
  /** RT_48: un déplacement de vue est en cours (mode actif ou bouton du milieu). */
  readonly panning = signal(false);
  /** RT_48: geste de déplacement de vue en cours. */
  private panDrag: {
    pointerId: number;
    start: { x: number; y: number };
    startOffset: { dx: number; dy: number };
  } | null = null;
  /**
   * RT_47: échelle d'affichage — facteur de base de RT_19 × agrandissement.
   * C'est elle qu'emploient le rendu, le retour de glisser et les conversions
   * écran ↔ asset ; les placements (RT_04) n'en dépendent pas.
   */
  readonly scale = computed(() => this.baseScale() * this.zoom());
  /** RT_34: retour visuel du glisser en cours ; nul hors de tout geste. */
  readonly dragGhost = signal<DragGhostView | null>(null);
  /** RT_34: modèle actuellement saisi, rendu comme tel au bandeau et au plateau. */
  readonly grabbedModelId = signal<string | null>(null);
  /** RT_36: token posé dont le geste en cours romprait la cohésion de l'unité. */
  readonly refusedModelId = signal<string | null>(null);
  /**
   * RG_29: un geste (dépôt, déplacement, rotation) est en cours. Tout geste
   * porte sur le token sélectionné, que la prise sélectionne.
   */
  private readonly gestureActive = signal(false);
  /**
   * RT_37: terrain du plateau affiché ; `null` s'il n'est pas décrit,
   * `undefined` tant qu'il n'est pas chargé.
   */
  private readonly terrain = signal<BoardTerrain | null | undefined>(undefined);

  readonly list = computed<ArmyList | undefined>(() => this.library.list(this.listId()));

  /**
   * RT_46: groupes de déploiement de la liste — une unité attachée (RG_36) y
   * est un seul groupe. Recalculés au chargement, ni persistés ni synchronisés.
   */
  readonly groups = computed<readonly DeploymentGroup[]>(() => deploymentGroups(this.list()?.units ?? []));

  /** RT_46: groupe de déploiement de chaque unité, par identifiant. */
  private readonly groupOfUnit = computed(() => groupIdByUnit(this.groups()));

  /** RG_15/RG_37: l'unité de déploiement sur laquelle est positionné le bandeau. */
  readonly selectedGroup = computed<DeploymentGroup | undefined>(
    () => this.groups()[this.selectedGroupIndex()],
  );

  readonly placements = computed<readonly Placement[]>(() => this.deployment()?.placements ?? []);

  /** RG_25/RT_35: unités déclarées en réserve sur ce déploiement. */
  readonly reservedUnits = computed<ReadonlySet<string>>(() => reservedUnitIds(this.deployment()));

  /**
   * RG_25: état de la case à cocher du bandeau, pour l'unité courante.
   * RG_37: une unité attachée est en réserve dès que l'une de ses composantes l'est.
   */
  readonly selectedUnitReserved = computed(() => {
    const group = this.selectedGroup();
    return !!group && isGroupReserved(group, this.reservedUnits());
  });

  /** RT_05: pixels d'asset par millimètre réel du socle. */
  readonly pixelsPerMm = computed(() => {
    const board = this.board();
    const referential = this.boardReferential();
    return board && referential ? assetPixelsPerMm(board, referential) : 1;
  });

  /**
   * RG_15/RT_17: les modèles individuels de l'unité sélectionnée qu'il reste
   * à poser. Un modèle déposé sur le plateau en sort aussitôt : le bandeau
   * n'énonce que le restant à déployer (RG_05).
   *
   * RT_17: cette liste est dérivée des placements de RT_04 — les identifiants
   * de modèle de l'unité qui n'apparaissent dans aucun placement — et non
   * d'un état propre au bandeau ; la sortie d'un modèle posé comme sa
   * réapparition après retrait du token (RG_20) découlent du seul recalcul
   * de cette différence.
   */
  readonly bandModels = computed<readonly BandModel[]>(() => {
    const deploymentGroup = this.selectedGroup();
    // RG_25: une unité en réserve n'a aucun modèle à poser sur le plateau.
    if (!deploymentGroup || isGroupReserved(deploymentGroup, this.reservedUnits())) return [];
    const shapes = this.shapes();
    // RG_37/RT_46: la rangée réunit les modèles restant à poser de toutes les
    // composantes, personnages d'abord. Un `idModele` (`<idUnite>_g<n>#<rang>`)
    // porte déjà sa composante : il identifie le modèle dans tout le groupe.
    return deploymentGroup.units.flatMap((unit) => {
      const placed = placedModelIds(this.placements(), unit.id);
      const component = componentLabel(deploymentGroup, unit);
      return unit.modelGroups.flatMap((group) =>
        modelIdsOfGroup(group)
          .filter((idModele) => !placed.has(idModele))
          .map((idModele) => ({
            idModele,
            unit,
            group,
            // RT_28: un rectangle sur mesure se rend comme n'importe quel socle.
            shape: resolveGroupShape(group, shapes),
            color: unit.color ?? UNIT_COLOR_FALLBACK,
            label: deploymentGroup.units.length > 1 ? `${component} — ${group.name}` : group.name,
          })),
      );
    });
  });

  /**
   * RT_33: l'échelle des socles du bandeau s'adapte à la hauteur réservée,
   * et non l'inverse — sans quoi une unité à socles de 170 mm ferait grandir
   * le bandeau, donc rétrécir le plateau, donc re-cadrer tout l'écran
   * (RG_17/RT_19) au simple passage à l'unité suivante.
   *
   * RT_05: les proportions relatives des socles d'une même unité restent
   * exactes, seule l'échelle commune est abaissée.
   */
  readonly bandPixelsPerMm = computed(() => {
    const deploymentGroup = this.selectedGroup();
    if (!deploymentGroup) return BAND_PIXELS_PER_MM;
    const shapes = this.shapes();
    // RG_15/RT_33: l'échelle se mesure sur *tous* les socles de l'unité, y
    // compris ceux déjà posés et donc sortis du bandeau — sinon le départ du
    // plus grand socle ferait grandir d'un coup les modèles restants.
    // RG_37: toutes composantes confondues, pour une unité attachée.
    const modelGroups = deploymentGroup.units.flatMap((unit) => unit.modelGroups);
    const largestMm = modelGroups.reduce((max, group) => {
      const shape = resolveGroupShape(group, shapes);
      return shape ? Math.max(max, shape.widthMm, shape.lengthMm) : max;
    }, 0);
    if (largestMm <= 0) return BAND_PIXELS_PER_MM;
    // `app-base-token` rend un carré de `plus grande dimension × échelle + 4`
    // pixels — les 4 px laissent la rotation (RG_20) ne jamais rogner.
    return Math.min(BAND_PIXELS_PER_MM, (BAND_TOKEN_BOX_PX - 4) / largestMm);
  });

  /**
   * RG_32/RG_24: nombre de modèles sélectionnés dans le bandeau — seuls ceux
   * qui y figurent encore comptent, un modèle posé en étant sorti (RT_41).
   */
  readonly bandSelectedCount = computed(() => {
    const selected = this.bandSelection();
    return this.bandModels().filter((model) => selected.has(model.idModele)).length;
  });

  readonly remainingInUnit = computed(() => {
    const deploymentGroup = this.selectedGroup();
    if (!deploymentGroup) return 0;
    return deploymentGroup.modelCount - placedCountOfGroup(deploymentGroup, this.placements());
  });

  /** RG_16/RT_18: vue du menu unités — groupes de socles, comptes et statuts. */
  readonly menuViews = computed<readonly UnitMenuView[]>(() => {
    const list = this.list();
    // RG_25/RT_35: la réserve entre dans le statut d'unité au même titre que
    // les placements — une unité réservée s'y annonce complète.
    return list ? unitMenuViews(list, this.placements(), this.reservedUnits()) : [];
  });

  /** RT_28: le socle effectif de chaque groupe, rectangle sur mesure inclus. */
  private readonly groupShapes = computed<ReadonlyMap<string, BaseShape | undefined>>(() => {
    const shapes = this.shapes();
    const groupShape = new Map<string, BaseShape | undefined>();
    for (const unit of this.list()?.units ?? []) {
      for (const group of unit.modelGroups) groupShape.set(group.id, resolveGroupShape(group, shapes));
    }
    return groupShape;
  });

  readonly tokens = computed<readonly TokenView[]>(() => {
    const list = this.list();
    if (!list) return [];

    const perMm = this.pixelsPerMm();
    const selected = this.selection();
    const offset = this.groupOffset();
    const groupShape = this.groupShapes();
    const unitColor = new Map(list.units.map((unit) => [unit.id, unit.color]));
    // RG_37/RG_24: le nom accessible de chaque token énonce sa composante.
    const unitLabel = new Map(
      this.groups().flatMap((group) => group.units.map((unit) => [unit.id, componentLabel(group, unit)] as const)),
    );

    const views: TokenView[] = [];
    for (const placement of this.placements()) {
      const shape = groupShape.get(placement.idModele.split('#')[0]);
      if (!shape) continue;
      const size = tokenSize(shape, perMm);
      const moving = !!offset && selected.has(placement.idModele);
      views.push({
        // RT_40: le groupe suit le doigt en rendu seul, sans écriture RT_04.
        placement: moving
          ? { ...placement, x: placement.x + offset.dx, y: placement.y + offset.dy }
          : placement,
        // RT_32: repli unique, partagé avec le visualiseur.
        color: unitColor.get(placement.idUnite) ?? UNIT_COLOR_FALLBACK,
        rx: size.width / 2,
        ry: size.height / 2,
        shapeKind: shape.shape,
        selected: selected.has(placement.idModele),
        label: unitLabel.get(placement.idUnite) ?? '',
      });
    }
    return views;
  });

  /** RG_30: nombre de tokens posés sélectionnés. */
  readonly selectedCount = computed(() => this.tokens().filter((token) => token.selected).length);

  /** RG_20/RG_29: le token sélectionné, seulement s'il est le seul. */
  readonly selectedToken = computed<TokenView | undefined>(() =>
    this.selectedCount() === 1 ? this.tokens().find((token) => token.selected) : undefined,
  );

  /** RT_38: terrain du plateau prêt pour le calcul, préparé une fois par plateau. */
  private readonly preparedTerrain = computed(() => {
    const terrain = this.terrain();
    const board = this.board();
    return terrain && board ? prepareTerrain(terrain, board.playArea, this.pixelsPerMm()) : null;
  });

  /**
   * RG_29: socle du token sélectionné, comparé par valeur — le déplacement
   * d'un autre token ne relance pas le calcul, les modèles n'étant pas des
   * obstacles (RG_27).
   */
  private readonly selectedBase = computed<BaseFootprint | null>(
    () => {
      const id = this.selectedPlacementId();
      const placement = id ? this.placements().find((p) => p.idModele === id) : undefined;
      const shape = placement ? this.groupShapes().get(placement.idModele.split('#')[0]) : undefined;
      return placement && shape ? visibilityBase(placement, shape, this.pixelsPerMm()) : null;
    },
    {
      equal: (a, b) =>
        a === b ||
        (!!a &&
          !!b &&
          a.x === b.x &&
          a.y === b.y &&
          a.rotation === b.rotation &&
          a.shape === b.shape &&
          a.width === b.width &&
          a.length === b.length),
    },
  );

  /**
   * RG_29/RT_39: zone visible depuis le token sélectionné, en un chemin SVG.
   * Masquée pendant un geste plutôt que laissée à son ancienne position, et
   * recalculée au relâchement : le calcul (RT_38) ne suit pas le doigt.
   */
  readonly visibleZonePath = computed<string | null>(() => {
    if (this.gestureActive()) return null;
    const base = this.selectedBase();
    const terrain = this.preparedTerrain();
    return base && terrain ? visibleZonePath(visibleZone(base, terrain)) : null;
  });

  /** RG_29: le terrain de ce plateau n'est pas décrit — aucune zone ne peut être colorée. */
  readonly visibleZoneUnavailable = computed(() => this.terrain() === null);

  /**
   * RG_35/RG_24: unités qu'un déplacement libre a sorties de leur cohésion
   * depuis l'activation du mode « Règle » — retaillées à sa sortie.
   */
  readonly rulerBrokenUnits = computed<ReadonlySet<string>>(() => {
    if (!this.rulerMode()) return new Set();
    const placements = this.placements();
    return new Set([...this.rulerCoherentUnits()].filter((groupId) => !this.groupCoherent(groupId, placements)));
  });

  /** RG_35/RG_24: l'unité du bandeau est-elle à retailler à la sortie du mode ? */
  readonly selectedUnitBroken = computed(() => {
    const deploymentGroup = this.selectedGroup();
    return !!deploymentGroup && this.rulerBrokenUnits().has(deploymentGroup.id);
  });

  /**
   * RG_33/RT_43: tracé de la règle et position de son étiquette. L'étiquette
   * est posée à côté du second point, du côté opposé au premier — hors du doigt
   * qui le désigne —, puis ramenée dans le plateau si elle en sortirait.
   */
  readonly rulerView = computed<RulerView | null>(() => {
    const measure = this.measure();
    const board = this.board();
    const scale = this.scale();
    if (!measure || !board || scale <= 0) return null;
    const dx = measure.to.x - measure.from.x;
    const dy = measure.to.y - measure.from.y;
    const length = Math.hypot(dx, dy);
    // Segment nul : l'étiquette part vers le haut, à l'opposé de la main.
    const ux = length > 0 ? dx / length : 0;
    const uy = length > 0 ? dy / length : -1;
    const width = board.playArea.width * scale;
    const height = board.playArea.height * scale;
    const clampTo = (value: number, half: number, max: number) =>
      Math.min(Math.max(value, half), Math.max(half, max - half));
    return {
      ...measure,
      label: formatInches(measureInches(measure.from, measure.to, this.pixelsPerMm())),
      labelLeft: clampTo(
        (measure.to.x - board.playArea.left) * scale + ux * RULER_LABEL_OFFSET_PX,
        RULER_LABEL_HALF_WIDTH_PX,
        width,
      ),
      labelTop: clampTo(
        (measure.to.y - board.playArea.top) * scale + uy * RULER_LABEL_OFFSET_PX,
        RULER_LABEL_HALF_HEIGHT_PX,
        height,
      ),
      endRadius: 8 / scale,
    };
  });

  /**
   * RG_05/RG_15: rangs, parmi les groupes de déploiement, de ceux ayant encore
   * au moins un modèle à poser — les seuls que les flèches du bandeau
   * parcourent. RG_37: une unité attachée n'y figure qu'une fois.
   */
  private readonly pendingUnitIndexes = computed<readonly number[]>(() => {
    const placements = this.placements();
    // RG_25: une unité en réserve est déployée — les flèches ne s'y arrêtent
    // plus, exactement comme sur une unité dont tous les modèles sont posés.
    const reserved = this.reservedUnits();
    const indexes: number[] = [];
    this.groups().forEach((group, index) => {
      if (!isGroupDeployed(group, placements, reserved)) indexes.push(index);
    });
    return indexes;
  });

  async ngOnInit(): Promise<void> {
    // RG_33/RT_42: le premier appui suivant, où qu'il porte, efface le tracé.
    // En capture, avant sa cible, sans en bloquer l'effet ordinaire : le geste
    // qui commence une nouvelle mesure la crée ensuite dans son gestionnaire.
    // RG_33/RT_42: les contrôles de vue (RT_49) et le déplacement de vue
    // (RT_48) ne changent rien au plateau et laissent la mesure en place.
    const clearMeasure = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-view-control]')) return;
      if (this.startsViewPan(event)) return;
      this.measure.set(null);
    };
    const hostElement = this.host.nativeElement;
    hostElement.addEventListener('pointerdown', clearMeasure, true);
    this.destroyRef.onDestroy(() => hostElement.removeEventListener('pointerdown', clearMeasure, true));

    this.listId.set(this.route.snapshot.paramMap.get('listId') ?? '');
    this.opponentId.set(this.route.snapshot.paramMap.get('opponentId') ?? '');
    this.boardId.set(this.route.snapshot.paramMap.get('boardId') ?? '');
    await this.library.load();

    const list = this.list();
    const board = await this.referential.board(this.boardId());
    // RG_03: pas de placement possible sans liste, disposition adverse et
    // plateau déjà choisis.
    if (!list || !board || !this.opponentId()) {
      await this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }
    this.board.set(board);
    this.boardReferential.set(await this.referential.boardReferential());
    this.terrain.set(await this.referential.terrain(board.id));

    const shapes = await this.referential.allBaseShapes();
    this.shapes.set(new Map(shapes.map((shape) => [shape.id, shape])));

    // Le déploiement du triplet a été créé (ou remis à zéro) par l'écran 4.
    this.deployment.set(
      this.library.deploymentFor(list.id, this.opponentId(), board.id) ??
        (await this.library.openDeployment({
          listId: list.id,
          opponentDispositionId: this.opponentId(),
          boardId: board.id,
          defaultName: this.library.defaultDeploymentName(list.name, `Plateau ${board.index}`),
          reset: false,
        })),
    );

    // RG_15: à la réouverture d'un déploiement déjà commencé, le bandeau se
    // positionne d'emblée sur la première unité ayant encore des modèles à
    // poser — les unités complètes n'y sont plus proposées.
    const firstPending = this.pendingUnitIndexes()[0];
    if (firstPending !== undefined) this.selectedGroupIndex.set(firstPending);

    // RT_46: un groupe est en réserve dès que l'une de ses unités y figure ; la
    // liste est complétée ici, et écrite avec la prochaine sauvegarde.
    const deployment = this.deployment();
    if (deployment) {
      const reserved = reservedUnitIds(deployment);
      const completed = this.groups()
        .filter((group) => isGroupReserved(group, reserved))
        .flatMap((group) => group.units.map((unit) => unit.id));
      if (completed.some((id) => !reserved.has(id))) {
        this.deployment.set({ ...deployment, reservedUnitIds: [...new Set([...reserved, ...completed])] });
      }
    }

    this.observeAvailableSpace();
    this.listenViewPan();
  }

  /**
   * RT_19: le facteur d'échelle n'est recalculé que lorsque l'espace
   * disponible change (rotation de l'écran, redimensionnement de fenêtre) —
   * jamais par changement de plateau, tous les assets ayant les mêmes
   * dimensions.
   */
  private observeAvailableSpace(): void {
    const recompute = () => {
      const host = this.boardArea?.nativeElement;
      const board = this.board();
      if (!host || !board) return;
      // RT_19/RT_47: seul le facteur de base est recalculé ; l'agrandissement
      // en cours est conservé, et le décalage de vue reborné.
      this.baseScale.set(
        containFitScale(
          { width: host.clientWidth, height: host.clientHeight },
          // RT_19: le facteur se calcule sur le rectangle de jeu mesuré
          // (`playArea`), pas sur l'image entière.
          { width: board.playArea.width, height: board.playArea.height },
        ),
      );
      this.setViewOffset(this.viewOffset());
    };

    // Premier calcul après le rendu initial du gabarit.
    setTimeout(recompute);

    if (typeof ResizeObserver !== 'undefined' && this.boardArea) {
      const observer = new ResizeObserver(recompute);
      observer.observe(this.boardArea.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    } else {
      globalThis.addEventListener?.('resize', recompute);
      this.destroyRef.onDestroy(() => globalThis.removeEventListener?.('resize', recompute));
    }
  }

  // -------------------------------------------------------------------------
  // RG_38/RG_39 — agrandissement ×2 et déplacement de la vue
  // -------------------------------------------------------------------------

  /**
   * RG_38: bascule entre le zoom de base et ×2 — aucun autre niveau. Le
   * passage à ×2 part du décalage nul (RT_47) : la surface étant centrée, le
   * point sous le centre de la zone y reste. Le retour au zoom de base rétablit
   * le cadrage de RG_17 et quitte le mode « Déplacement » (RG_39). Rien n'est
   * écrit : seul l'affichage change.
   */
  toggleZoom(): void {
    this.zoom.set(this.zoom() === 1 ? 2 : 1);
    this.viewOffset.set({ dx: 0, dy: 0 });
    if (this.zoom() === 1) this.panMode.set(false);
  }

  /** RG_39: le mode « Déplacement » n'est disponible qu'à ×2. */
  togglePanMode(): void {
    if (this.zoom() === 1) return;
    this.panMode.set(!this.panMode());
  }

  /** RT_47: pose le décalage de vue, borné pour que la vue ne sorte pas du plateau. */
  private setViewOffset(offset: { dx: number; dy: number }): void {
    const area = this.boardArea?.nativeElement;
    const board = this.board();
    const scale = this.scale();
    if (!area || !board || scale <= 0) {
      this.viewOffset.set({ dx: 0, dy: 0 });
      return;
    }
    this.viewOffset.set(
      clampViewOffset(
        offset,
        { width: board.playArea.width * scale, height: board.playArea.height * scale },
        { width: area.clientWidth, height: area.clientHeight },
      ),
    );
  }

  /**
   * RT_48: cet appui commence-t-il un déplacement de vue ? Mode « Déplacement »
   * actif et appui sur le plateau, ou bouton du milieu — quel que soit le mode.
   * Les contrôles superposés au plateau (RT_49, barre d'actions de RT_33) en
   * sont exclus.
   */
  private startsViewPan(event: PointerEvent): boolean {
    const area = this.boardArea?.nativeElement;
    const target = event.target as Element | null;
    if (!area || !target || !area.contains(target)) return false;
    if (target.closest('[data-view-control], .token-actions')) return false;
    return event.button === 1 || this.panMode();
  }

  /**
   * RT_48: écoute en capture sur la zone du plateau, avant les gestionnaires
   * des tokens, de la poignée de rotation et du fond, qui ne reçoivent donc
   * pas l'appui d'un déplacement de vue.
   */
  private listenViewPan(): void {
    const area = this.boardArea?.nativeElement;
    if (!area) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!this.startsViewPan(event)) return;
      event.stopPropagation();
      // RG_39: pas de défilement automatique du navigateur au clic molette.
      event.preventDefault();
      if (this.panDrag) return;
      this.panDrag = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        startOffset: this.viewOffset(),
      };
      this.panning.set(true);
      try {
        area.setPointerCapture?.(event.pointerId);
      } catch {
        // Confort seulement : le geste reste suivi par les écouteurs de l'écran.
      }
    };
    // RG_39: le défilement automatique se déclenche sur le `mousedown` du
    // bouton du milieu, que l'annulation du `pointerdown` ne couvre pas partout.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    area.addEventListener('pointerdown', onPointerDown, true);
    area.addEventListener('mousedown', onMouseDown, true);
    this.destroyRef.onDestroy(() => {
      area.removeEventListener('pointerdown', onPointerDown, true);
      area.removeEventListener('mousedown', onMouseDown, true);
    });
  }

  /** RT_48: le plateau suit le pointeur ; rien n'est écrit. */
  private trackViewPan(event: PointerEvent): boolean {
    const pan = this.panDrag;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    this.setViewOffset({
      dx: pan.startOffset.dx + event.clientX - pan.start.x,
      dy: pan.startOffset.dy + event.clientY - pan.start.y,
    });
    return true;
  }

  /** RT_48: fin du geste — relâchement du doigt, du bouton principal ou du milieu. */
  private endViewPan(event: PointerEvent): boolean {
    const pan = this.panDrag;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    this.panDrag = null;
    this.panning.set(false);
    return true;
  }

  /**
   * RG_38: un dépôt depuis le bandeau ne vaut que sur la partie affichée du
   * plateau — la partie masquée par l'agrandissement est hors d'atteinte.
   */
  private isInsideView(event: PointerEvent): boolean {
    const area = this.boardArea?.nativeElement;
    if (!area) return false;
    const rect = area.getBoundingClientRect();
    return (
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    );
  }

  // -------------------------------------------------------------------------
  // RG_15 — bandeau de sélection de l'unité
  // -------------------------------------------------------------------------

  /** RG_15: flèches de part et d'autre du bandeau (unité précédente/suivante). */
  previousUnit(): void {
    this.stepUnit(-1);
  }

  nextUnit(): void {
    this.stepUnit(1);
  }

  /**
   * RG_15: les flèches ne s'arrêtent que sur une unité ayant encore quelque
   * chose à poser — une unité complète n'est plus proposée par le bandeau.
   * Si plus aucune ne l'est (déploiement terminé au sens de RG_14), on reste
   * sur l'unité courante, qui s'annonce complète.
   */
  private stepUnit(direction: 1 | -1): void {
    const count = this.groups().length;
    const pending = this.pendingUnitIndexes();
    if (count === 0 || pending.length === 0) return;
    const current = this.selectedGroupIndex();
    for (let offset = 1; offset <= count; offset += 1) {
      const candidate = (((current + direction * offset) % count) + count) % count;
      if (pending.includes(candidate)) {
        this.selectUnitIndex(candidate);
        return;
      }
    }
  }

  /**
   * RG_16: cliquer une entrée du menu burger ferme le menu et bascule le
   * bandeau sur l'unité choisie.
   */
  selectUnitFromMenu(view: UnitMenuView): void {
    const index = this.groups().findIndex((group) => group.id === view.deploymentGroup.id);
    if (index >= 0) this.selectUnitIndex(index);
    this.menuOpen.set(false);
  }

  /**
   * RG_15: bascule le bandeau sur une unité. RG_32/RT_41: la sélection du
   * bandeau ne survit pas au changement d'unité.
   */
  private selectUnitIndex(index: number): void {
    if (index !== this.selectedGroupIndex()) this.bandSelection.set(new Set());
    this.selectedGroupIndex.set(index);
  }

  /**
   * RG_30/RT_40: fixe la sélection depuis un geste sur le plateau.
   * RG_15/RT_40: si tous les tokens sélectionnés sont d'une même unité, le
   * bandeau bascule sur elle. Appelé aux seuls gestes du plateau, jamais par
   * un effet : un dépôt depuis le bandeau ne doit pas défaire l'avance
   * automatique vers l'unité suivante.
   */
  private selectOnBoard(ids: Iterable<string>): void {
    const selection = new Set(ids);
    this.selection.set(selection);
    // RG_37/RT_40: la bascule compte des groupes de déploiement, pas des unités.
    const groupId = soleSelectedUnit(this.placements(), selection, (idUnite) => this.groupIdOf(idUnite));
    if (groupId === null) return;
    const index = this.groups().findIndex((group) => group.id === groupId);
    if (index >= 0) this.selectUnitIndex(index);
  }

  // -------------------------------------------------------------------------
  // RG_25 — mise en réserve d'une unité
  // -------------------------------------------------------------------------

  /**
   * RG_25: la case à cocher du bandeau déclare l'unité courante en réserve,
   * ou l'en retire. Mettre en réserve une unité dont des modèles sont déjà
   * posés retire ces placements : l'opération étant destructrice, elle est
   * confirmée explicitement (même principe que RG_08).
   *
   * La case est repositionnée à la main sur l'état réel en sortie : elle
   * s'est cochée d'elle-même au contact, alors que l'état de l'unité ne
   * change qu'ici — un refus de la confirmation, comme l'avance automatique
   * à l'unité suivante, laisserait sinon une case cochée sur une unité qui
   * ne l'est pas.
   */
  async toggleReserve(event: Event, checkbox: { checked: boolean }): Promise<void> {
    const deploymentGroup = this.selectedGroup();
    const wanted = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    if (!deploymentGroup || !this.deployment() || wanted === this.selectedUnitReserved()) {
      checkbox.checked = this.selectedUnitReserved();
      return;
    }

    // RG_37: la confirmation compte les tokens de toutes les composantes.
    const placed = placedCountOfGroup(deploymentGroup, this.placements());
    if (!wanted || placed === 0) {
      this.setReserved(deploymentGroup, wanted);
      checkbox.checked = this.selectedUnitReserved();
      return;
    }

    const alert = await this.alerts.create({
      header: 'Mettre cette unité en réserve ?',
      message:
        `${placed} modèle(s) de « ${deploymentGroup.name} » sont posés sur le plateau. ` +
        `Une unité en réserve n'a aucun token sur le plateau : ces placements ` +
        `seront définitivement retirés.`,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        { text: 'Mettre en réserve', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') this.setReserved(deploymentGroup, true);
    checkbox.checked = this.selectedUnitReserved();
  }

  /**
   * RT_35: la réserve est enregistrée sur le déploiement, à côté des
   * placements — aucun placement n'est fabriqué pour une unité réservée, et
   * ceux qu'elle avait sont retirés (RG_25). EX_04/RG_07: l'écriture est
   * continue, comme pour un placement.
   *
   * RG_37/RT_46: une unité attachée entre en réserve et en sort tout entière —
   * toutes ses composantes sont inscrites, ou retirées, en une seule écriture.
   */
  private setReserved(deploymentGroup: DeploymentGroup, reserved: boolean): void {
    const deployment = this.deployment();
    if (!deployment) return;

    const unitIds = new Set(deploymentGroup.units.map((unit) => unit.id));
    const ids = new Set(deployment.reservedUnitIds ?? []);
    for (const id of unitIds) {
      if (reserved) ids.add(id);
      else ids.delete(id);
    }
    // RG_32: la mise en réserve vide le bandeau, et sa sélection avec lui.
    this.bandSelection.set(new Set());

    const placements = reserved
      ? deployment.placements.filter((placement) => !unitIds.has(placement.idUnite))
      : deployment.placements;

    this.deployment.set({ ...deployment, placements, reservedUnitIds: [...ids] });

    // Le token sélectionné a pu disparaître avec les placements de l'unité.
    const remaining = [...this.selection()].filter((id) => placements.some((placement) => placement.idModele === id));
    if (remaining.length !== this.selection().size) this.selection.set(new Set(remaining));
    this.scheduleSave();

    // RG_15: l'unité n'étant plus en attente, le bandeau enchaîne sur la
    // suivante qui l'est — comme après la pose de son dernier modèle.
    if (reserved) this.stepUnit(1);
  }

  // -------------------------------------------------------------------------
  // RG_26 — cohésion d'unité
  // -------------------------------------------------------------------------

  /** RT_46: groupe de déploiement d'une unité — elle-même si elle est indépendante. */
  private groupIdOf(idUnite: string): string {
    return this.groupOfUnit().get(idUnite) ?? idUnite;
  }

  /**
   * RT_36: socles posés d'un groupe de déploiement, en pouces réels, dans
   * l'ordre des placements — donc des dépôts, que suit le départage de RG_26
   * au retrait. RG_37/RT_46: toutes les composantes d'une unité attachée,
   * personnages compris, forment un seul graphe de cohésion.
   */
  private groupBases(groupId: string, placements: readonly Placement[]): CoherencyBase[] {
    const groupShape = this.groupShapes();
    const perMm = this.pixelsPerMm();
    const bases: CoherencyBase[] = [];
    for (const placement of placements) {
      if (this.groupIdOf(placement.idUnite) !== groupId) continue;
      const shape = groupShape.get(placement.idModele.split('#')[0]);
      if (shape) bases.push(coherencyBase(placement, shape, perMm));
    }
    return bases;
  }

  private groupCoherent(groupId: string, placements: readonly Placement[]): boolean {
    return isCoherent(this.groupBases(groupId, placements));
  }

  /**
   * RG_26: le geste en cours, s'il aboutissait avec `candidate` comme
   * placement du modèle saisi, laisserait-il l'unité en cohésion ? Une unité
   * déjà hors cohésion au début du geste n'est pas contrôlée.
   */
  private keepsCoherency(drag: DragState, candidate: Placement): boolean {
    if (!drag.wasCoherent) return true;
    const others = this.placements().filter((placement) => placement.idModele !== candidate.idModele);
    return this.groupCoherent(drag.groupId, [...others, candidate]);
  }

  /** RG_26: l'issue refusée d'un geste sans retour de glisser est annoncée. */
  private async announceRefusal(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2500, position: 'top' });
    await toast.present();
  }

  // -------------------------------------------------------------------------
  // RG_33/RG_35 — mode « Règle »
  // -------------------------------------------------------------------------

  /** RG_33: le bouton règle active le mode, ou le désactive (RG_35). */
  async toggleRuler(): Promise<void> {
    if (this.rulerMode()) {
      await this.leaveRulerMode();
      return;
    }
    // RT_44: instantané des unités en cohésion à l'activation — seules
    // candidates au rétablissement de la sortie du mode.
    const placements = this.placements();
    const coherent = this.groups()
      .map((group) => group.id)
      .filter((groupId) => this.groupCoherent(groupId, placements));
    this.rulerCoherentUnits.set(new Set(coherent));
    this.rulerMode.set(true);
  }

  /**
   * RG_35/RT_44: sortie du mode « Règle ». Chaque unité en cohésion à
   * l'activation et qui ne l'est plus est retaillée comme au retrait d'un
   * token (RG_26) : le groupe contigu le plus nombreux reste, les autres
   * retournent au bandeau. Retirant des tokens, l'opération est confirmée ;
   * l'annuler laisse le mode actif. Rend vrai si le mode est désactivé.
   */
  private async leaveRulerMode(): Promise<boolean> {
    if (!this.rulerMode()) return true;
    const placements = this.placements();
    const groups = this.groups();
    const removed = new Set<string>();
    const trimmed: string[] = [];
    const stretched: string[] = [];
    for (const groupId of this.rulerBrokenUnits()) {
      const name = groups.find((group) => group.id === groupId)?.name ?? groupId;
      // RT_44: même algorithme que le retrait (RT_36), sur l'unité entière —
      // RG_37: l'unité attachée entière.
      const detached = new Set(detachedAfterRemoval(this.groupBases(groupId, placements)));
      if (detached.size > 0) {
        detached.forEach((id) => removed.add(id));
        trimmed.push(`« ${name} » : ${detached.size} token(s)`);
      }
      // RG_35: l'étendue de 9" n'est pas retaillée — l'unité est seulement
      // signalée, et traitée ensuite comme déjà hors cohésion (RG_26).
      const kept = placements.filter((p) => this.groupIdOf(p.idUnite) === groupId && !detached.has(p.idModele));
      if (!this.groupCoherent(groupId, kept)) stretched.push(`« ${name} »`);
    }

    const stretchedNote =
      stretched.length > 0
        ? `${stretched.join(', ')} dépasse(nt) l'étendue de 9" et reste(nt) hors cohésion, à corriger à la main.`
        : '';

    if (removed.size > 0) {
      const alert = await this.alerts.create({
        header: 'Quitter le mode Règle ?',
        message:
          `Des déplacements ont rompu la cohésion d'unités. Pour la rétablir, le groupe le plus ` +
          `nombreux de chacune est conservé et ces tokens retournent au bandeau — ` +
          `${trimmed.join(' ; ')}. ${stretchedNote}`.trim(),
        buttons: [
          { text: 'Annuler', role: 'cancel' },
          { text: 'Retirer et quitter', role: 'destructive' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'destructive') return false;
      // RT_44: une seule écriture pour toutes les unités concernées (RG_07).
      this.mutatePlacements((current) => current.filter((p) => !removed.has(p.idModele)));
      this.selection.set(new Set([...this.selection()].filter((id) => !removed.has(id))));
    } else if (stretchedNote) {
      void this.announceRefusal(stretchedNote);
    }

    this.rulerMode.set(false);
    this.rulerCoherentUnits.set(new Set());
    this.measure.set(null);
    return true;
  }

  /**
   * RG_35/RT_44: garde de sortie de l'écran — quitter mode « Règle » actif
   * équivaut à le désactiver, et une annulation laisse le joueur sur l'écran.
   */
  async canLeave(): Promise<boolean> {
    if (!this.rulerMode()) return true;
    const left = await this.leaveRulerMode();
    if (left) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      await this.save();
    }
    return left;
  }

  /** RG_34/RT_42: met à jour le segment du déplacement en cours. */
  private trackMoveMeasure(drag: DragState, to: { x: number; y: number }, refused: boolean): void {
    if (drag.ruler) this.measure.set({ from: drag.startPosition, to, refused });
  }

  // -------------------------------------------------------------------------
  // RT_03 — drag & drop des tokens
  // -------------------------------------------------------------------------

  /**
   * La capture de pointeur garde les évènements de déplacement dirigés vers
   * l'élément saisi même si le doigt en sort. C'est un confort, pas une
   * condition : un échec de capture ne doit pas annuler le glisser.
   */
  private capturePointer(event: PointerEvent): void {
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId);
    } catch {
      // Pointeur déjà relâché ou non capturable : le glisser reste géré par
      // les écouteurs de l'écran.
    }
  }

  /** Convertit une position écran en coordonnées du repère de l'asset (RT_04). */
  private toAssetCoords(event: PointerEvent): { x: number; y: number } | null {
    const surface = this.boardSurface?.nativeElement;
    const scale = this.scale();
    const board = this.board();
    if (!surface || scale <= 0 || !board) return null;
    const rect = surface.getBoundingClientRect();
    return {
      // RT_19: la surface visible est rognée (bandeau de titre, marges
      // latérales) — son origine correspond à (playArea.left, playArea.top)
      // dans le repère de l'asset, pas à (0, 0).
      x: (event.clientX - rect.left) / scale + board.playArea.left,
      y: (event.clientY - rect.top) / scale + board.playArea.top,
    };
  }

  /**
   * RT_34: métriques du retour visuel d'un glisser, relevées à la saisie. Les
   * dimensions sont reçues en pixels d'asset (le repère de RT_04/RT_05) et
   * converties une fois ici à l'échelle d'affichage de RT_19 : le token
   * provisoire a exactement la taille que le socle aura une fois posé.
   */
  private ghostMetrics(
    assetWidth: number,
    assetHeight: number,
    shapeKind: BaseShapeKind,
    color: string,
    rotation: number,
    withToken: boolean,
  ): DragGhostMetrics {
    const scale = this.scale();
    const width = assetWidth * scale;
    const height = assetHeight * scale;
    return {
      // Le carré de rendu tient le plus grand des deux — le cercle de visée
      // pour un petit socle, le socle lui-même pour un gabarit de 170 mm.
      box: Math.max(DRAG_AIM_RADIUS_PX * 2, width, height) + 8,
      width,
      height,
      rotation,
      shapeKind,
      color,
      withToken,
    };
  }

  /**
   * RT_34: place le retour visuel sous le point de contact. Le centre suivi
   * est celui du socle : le point de contact lui-même pour un dépôt à venir,
   * ce point décalé de l'écart de saisie pour un token déjà posé — le même
   * écart que celui appliqué à ses coordonnées RT_04, pour que le cercle de
   * visée et le token ne se désolidarisent pas en cours de geste.
   */
  private trackGhost(drag: DragState, event: PointerEvent): void {
    const host = this.layout?.nativeElement;
    const board = this.board();
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const scale = this.scale();
    const point = this.toAssetCoords(event);
    // RG_38: un dépôt depuis le bandeau sur la partie masquée par
    // l'agrandissement est refusé, comme hors du rectangle de jeu.
    const fromBand = drag.kind === 'new' || drag.kind === 'cluster';
    const droppable =
      !!point && !!board && this.gestureAllowed(drag, point, board) && (!fromBand || this.isInsideView(event));
    // RT_36: un token posé dont le déplacement serait refusé le montre aussi.
    if (drag.kind === 'move') this.refusedModelId.set(droppable ? null : drag.idModele);
    if (drag.kind === 'group') this.groupRefused.set(!droppable);
    // RG_34: en mode « Règle », le segment suit le centre du token saisi.
    if (point && drag.kind === 'move') {
      this.trackMoveMeasure(drag, this.clamp(point.x + drag.grabOffset.x, point.y + drag.grabOffset.y), !droppable);
    }
    if (point && drag.kind === 'group') {
      const { dx, dy } = this.groupDelta(drag, point);
      this.trackMoveMeasure(drag, { x: drag.startPosition.x + dx, y: drag.startPosition.y + dy }, !droppable);
    }
    this.dragGhost.set({
      ...drag.ghost,
      left: event.clientX - rect.left + drag.grabOffset.x * scale,
      top: event.clientY - rect.top + drag.grabOffset.y * scale,
      // RT_34/RT_36: le refus est annoncé avant le relâchement plutôt qu'au
      // relâchement.
      droppable,
    });
  }

  /**
   * RT_34/RT_36: relâcher le glisser à ce point aboutirait-il ? Un nouveau
   * token est refusé hors du rectangle de jeu ; un déplacement, borné à ce
   * rectangle par `clamp`, n'y est jamais refusé. Tous deux le sont s'ils
   * rompaient la cohésion de l'unité (RG_26).
   */
  private gestureAllowed(drag: DragState, point: { x: number; y: number }, board: Board): boolean {
    if (drag.kind === 'new') {
      if (!this.isInsideBoard(point, board)) return false;
      const { x, y } = this.clamp(point.x, point.y);
      return this.keepsCoherency(drag, { idUnite: drag.idUnite, idModele: drag.idModele, x, y, rotation: 0 });
    }
    if (drag.kind === 'group') return this.groupMoveAllowed(drag, point, board);
    if (drag.kind === 'cluster') return this.clusterAllowed(drag, point, board);
    // RG_35/RT_44: en mode « Règle », un déplacement n'est pas refusé pour
    // perte de cohésion — et, borné au rectangle de jeu, jamais refusé du tout.
    if (drag.ruler) return true;
    const placement = this.placements().find((p) => p.idModele === drag.idModele);
    if (!placement) return true;
    const moved = this.clamp(point.x + drag.grabOffset.x, point.y + drag.grabOffset.y);
    return this.keepsCoherency(drag, { ...placement, ...moved });
  }

  /** RG_30/RT_40: vecteur de déplacement du groupe pour ce point de contact. */
  private groupDelta(drag: DragState, point: { x: number; y: number }): { dx: number; dy: number } {
    return {
      dx: point.x + drag.grabOffset.x - drag.startPosition.x,
      dy: point.y + drag.grabOffset.y - drag.startPosition.y,
    };
  }

  /**
   * RG_30/RT_40: le groupe, translaté du vecteur courant, reste-t-il tout
   * entier dans le rectangle de jeu et en cohésion (RG_26) pour chaque unité
   * qui l'était ? Un seul résultat négatif refuse le groupe entier.
   */
  private groupMoveAllowed(drag: DragState, point: { x: number; y: number }, board: Board): boolean {
    const group = drag.group;
    if (!group) return true;
    const { dx, dy } = this.groupDelta(drag, point);
    const moved = this.placements().map((p) =>
      group.ids.has(p.idModele) ? { ...p, x: p.x + dx, y: p.y + dy } : p,
    );
    // RG_30: un token qui sortirait du rectangle de jeu refuse le groupe.
    if (moved.some((p) => group.ids.has(p.idModele) && !this.isInsideBoard(p, board))) return false;
    // RG_35/RT_44: en mode « Règle », seule la sortie du rectangle refuse le groupe.
    if (drag.ruler) return true;
    // RG_26: seules les unités en cohésion à la saisie sont contrôlées.
    return [...group.coherentUnits].every((groupId) => this.groupCoherent(groupId, moved));
  }

  /**
   * RG_30/RT_40: début du glissement d'un token appartenant à une sélection
   * multiple — tous les tokens sélectionnés suivent le même vecteur.
   */
  private startGroupDrag(event: PointerEvent, token: TokenView): void {
    const ids = new Set(this.tokens().filter((t) => t.selected).map((t) => t.placement.idModele));
    const placements = this.placements();
    // RG_37/RT_46: la cohésion se contrôle par groupe de déploiement.
    const groupIds = new Set(placements.filter((p) => ids.has(p.idModele)).map((p) => this.groupIdOf(p.idUnite)));
    const coherentUnits = new Set([...groupIds].filter((groupId) => this.groupCoherent(groupId, placements)));
    const point = this.toAssetCoords(event);
    this.drag = {
      kind: 'group',
      idModele: token.placement.idModele,
      pointerId: event.pointerId,
      grabOffset: point
        ? { x: token.placement.x - point.x, y: token.placement.y - point.y }
        : { x: 0, y: 0 },
      startRotation: token.placement.rotation,
      startAngle: 0,
      idUnite: token.placement.idUnite,
      groupId: this.groupIdOf(token.placement.idUnite),
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: true,
      ghost: this.ghostMetrics(token.rx * 2, token.ry * 2, token.shapeKind, token.color, token.placement.rotation, false),
      group: { ids, coherentUnits },
      ruler: this.rulerMode(),
    };
    this.grabbedModelId.set(token.placement.idModele);
    this.gestureActive.set(true);
    this.groupOffset.set({ dx: 0, dy: 0 });
    this.trackGhost(this.drag, event);
  }

  /**
   * RG_30/RT_40: un appui sur le fond du plateau commence un rectangle de
   * sélection. Le déplacement de vue (RG_39/RT_48) est intercepté en amont,
   * en capture : ce gestionnaire ne reçoit jamais son appui.
   */
  onBoardPointerDown(event: PointerEvent): void {
    const point = this.toAssetCoords(event);
    if (!point) return;
    event.preventDefault();
    this.capturePointer(event);
    // RG_32: un appui sur le plateau annule la sélection du bandeau.
    this.bandSelection.set(new Set());
    if (this.rulerMode()) {
      // RG_33/RT_42: en mode « Règle », le même geste trace une mesure au lieu
      // du rectangle de sélection ; l'appui désélectionne toujours tout.
      this.selection.set(new Set());
      const start = this.clamp(point.x, point.y);
      this.rulerDrag = { pointerId: event.pointerId };
      this.measure.set({ from: start, to: start, refused: false });
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    this.marqueeState = { pointerId: event.pointerId, start: point, additive, previous: this.selection() };
    if (!additive) this.selection.set(new Set());
    this.marquee.set({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  }

  /** RG_30: au relâchement, sélectionne les tokens touchés par le rectangle. */
  private finishMarquee(state: MarqueeState, event: PointerEvent): void {
    this.marquee.set(null);
    const point = this.toAssetCoords(event);
    if (!point) return;
    const rect: SelectionRect = { x1: state.start.x, y1: state.start.y, x2: point.x, y2: point.y };
    // Un simple appui (ou un tracé de moins de 3 px) ne touche rien : il
    // désélectionne, ce qu'a déjà fait la saisie.
    if (Math.hypot(rect.x2 - rect.x1, rect.y2 - rect.y1) * this.scale() < 3) return;
    const perMm = this.pixelsPerMm();
    const groupShape = this.groupShapes();
    const items = this.placements().flatMap((placement) => {
      const shape = groupShape.get(placement.idModele.split('#')[0]);
      return shape ? [{ id: placement.idModele, base: visibilityBase(placement, shape, perMm) }] : [];
    });
    const touched = idsTouchedByRect(items, rect);
    this.selectOnBoard(state.additive ? [...state.previous, ...touched] : touched);
  }

  /**
   * RG_15/RT_17: début d'un glisser depuis le bandeau. Le drop créera un
   * enregistrement de placement au sens de RT_04 — un par modèle (RG_04).
   */
  onBandPointerDown(event: PointerEvent, model: BandModel): void {
    const deploymentGroup = this.selectedGroup();
    if (!model.shape || !deploymentGroup) return;
    event.preventDefault();
    // RT_41: l'appui est compté ici, pas une seconde fois par le corps du bandeau.
    event.stopPropagation();
    this.capturePointer(event);
    // RG_32/RT_41: le second appui d'un double appui sélectionne tout le
    // bandeau ; saisir un modèle de cette sélection emporte la grappe.
    if (this.registerBandTap(event)) this.selectWholeBand();
    if (this.bandSelection().has(model.idModele) && this.bandSelectedCount() > 1) {
      this.startClusterDrag(event, deploymentGroup);
      return;
    }
    this.bandSelection.set(new Set());
    const size = tokenSize(model.shape, this.pixelsPerMm());
    this.drag = {
      kind: 'new',
      idModele: model.idModele,
      pointerId: event.pointerId,
      grabOffset: { x: 0, y: 0 },
      startRotation: 0,
      startAngle: 0,
      // RG_37: le placement créé porte la composante du modèle, la cohésion
      // contrôlée est celle de tout le groupe.
      idUnite: model.unit.id,
      groupId: deploymentGroup.id,
      startPosition: { x: 0, y: 0 },
      wasCoherent: this.groupCoherent(deploymentGroup.id, this.placements()),
      // RT_34: le token provisoire est celui qui sera posé — même forme (RT_26),
      // même couleur de composante (RG_06/RG_37), même taille à l'écran (RT_05).
      ghost: this.ghostMetrics(size.width, size.height, model.shape.shape, model.color, 0, true),
    };
    this.selection.set(new Set([model.idModele]));
    this.gestureActive.set(true);
    // RT_34: dès le premier contact, le geste se voit — sans quoi rien ne
    // distingue un glisser commencé d'un appui sans effet.
    this.grabbedModelId.set(model.idModele);
    this.trackGhost(this.drag, event);
  }

  /**
   * RG_32/RT_41: appui sur le bandeau hors de sa rangée de modèles. Un double
   * appui sélectionne tous les modèles restant à poser ; un appui simple
   * annule cette sélection. La case « en réserve » n'y participe pas.
   */
  onBandBodyPointerDown(event: PointerEvent): void {
    if ((event.target as Element | null)?.closest?.('ion-checkbox')) return;
    if (this.registerBandTap(event)) this.selectWholeBand();
    else this.bandSelection.set(new Set());
  }

  /** RT_41: même critère de double appui que RT_40, sur toute la zone du bandeau. */
  private registerBandTap(event: PointerEvent): boolean {
    const tap = { id: 'band', time: event.timeStamp, x: event.clientX, y: event.clientY };
    const double = isDoubleTap(this.lastBandTap, tap);
    this.lastBandTap = double ? null : tap;
    return double;
  }

  /** RG_32: tous les modèles restant à poser de l'unité courante. */
  private selectWholeBand(): void {
    this.bandSelection.set(new Set(this.bandModels().filter((model) => model.shape).map((model) => model.idModele)));
  }

  /**
   * RG_32/RT_41: saisie de la grappe. La formation est calculée une fois, en
   * pouces réels, puis figée en décalages d'asset : le geste ne fait que la
   * translater sous le point de contact.
   */
  private startClusterDrag(event: PointerEvent, deploymentGroup: DeploymentGroup): void {
    const selected = this.bandSelection();
    const models = this.bandModels().filter(
      (model): model is BandModel & { shape: BaseShape } => !!model.shape && selected.has(model.idModele),
    );
    const layout = clusterLayout(
      models.map((model) => ({
        id: model.idModele,
        shape: model.shape.shape,
        width: model.shape.widthMm / MM_PER_INCH,
        length: model.shape.lengthMm / MM_PER_INCH,
      })),
    );
    const perMm = this.pixelsPerMm();
    const cluster = models.map((model) => {
      const offset = layout.get(model.idModele)!;
      // RG_37: chaque socle de la grappe garde sa composante.
      return {
        idUnite: model.unit.id,
        idModele: model.idModele,
        dx: offset.x * MM_PER_INCH * perMm,
        dy: offset.y * MM_PER_INCH * perMm,
      };
    });

    // RT_41: chaque socle provisoire à sa taille exacte (RT_05), et un cercle
    // englobant qui matérialise l'emprise de la grappe.
    const scale = this.scale();
    const members: GhostMember[] = models.map((model, index) => {
      const size = tokenSize(model.shape, perMm);
      return {
        x: cluster[index].dx * scale,
        y: cluster[index].dy * scale,
        width: size.width * scale,
        height: size.height * scale,
        shapeKind: model.shape.shape,
        // RG_37: chaque socle provisoire dans la couleur de sa composante.
        color: model.color,
      };
    });
    const envelope =
      Math.max(
        ...members.map(
          (member) =>
            Math.hypot(member.x, member.y) +
            (member.shapeKind === 'rectangle'
              ? Math.hypot(member.width, member.height) / 2
              : Math.max(member.width, member.height) / 2),
        ),
      ) + 4;

    this.drag = {
      kind: 'cluster',
      idModele: models[0].idModele,
      pointerId: event.pointerId,
      grabOffset: { x: 0, y: 0 },
      startRotation: 0,
      startAngle: 0,
      idUnite: models[0].unit.id,
      groupId: deploymentGroup.id,
      startPosition: { x: 0, y: 0 },
      // RG_26: une unité déjà hors cohésion n'est pas contrôlée.
      wasCoherent: this.groupCoherent(deploymentGroup.id, this.placements()),
      ghost: {
        box: Math.max(DRAG_AIM_RADIUS_PX, envelope) * 2 + 8,
        width: 0,
        height: 0,
        rotation: 0,
        shapeKind: 'round',
        color: models[0].color,
        withToken: false,
        members,
        envelope,
      },
      cluster,
    };
    this.selection.set(new Set());
    this.gestureActive.set(true);
    this.clusterGrabbed.set(true);
    this.trackGhost(this.drag, event);
  }

  /** RG_32/RT_41: placements candidats de la grappe centrée sur ce point. */
  private clusterPlacements(drag: DragState, point: { x: number; y: number }): Placement[] {
    // RG_32: rotation par défaut pour tous les modèles de la grappe.
    return (drag.cluster ?? []).map((member) => ({
      idUnite: member.idUnite,
      idModele: member.idModele,
      x: point.x + member.dx,
      y: point.y + member.dy,
      rotation: 0,
    }));
  }

  /**
   * RG_32/RT_41: tout ou rien — chaque centre dans le rectangle de jeu, et
   * l'unité, modèles déjà posés compris, en cohésion (RG_26) si elle l'était.
   */
  private clusterAllowed(drag: DragState, point: { x: number; y: number }, board: Board): boolean {
    const candidates = this.clusterPlacements(drag, point);
    if (candidates.some((placement) => !this.isInsideBoard(placement, board))) return false;
    if (!drag.wasCoherent) return true;
    return this.groupCoherent(drag.groupId, [...this.placements(), ...candidates]);
  }

  /** Déplacement d'un token déjà posé (RG_04 : « déplacer rapidement »). */
  onTokenPointerDown(event: PointerEvent, token: TokenView): void {
    event.preventDefault();
    event.stopPropagation();
    this.capturePointer(event);
    // RG_32: un appui sur le plateau annule la sélection du bandeau.
    this.bandSelection.set(new Set());
    const point = this.toAssetCoords(event);

    // RG_31/RT_40: le second appui d'un double clic étend la sélection à tous
    // les tokens posés de l'unité.
    const tap = { id: token.placement.idModele, time: event.timeStamp, x: event.clientX, y: event.clientY };
    if (isDoubleTap(this.lastTap, tap)) {
      this.lastTap = null;
      // RG_37: l'unité attachée entière, toutes composantes confondues.
      const groupId = this.groupIdOf(token.placement.idUnite);
      const unitIds = this.placements()
        .filter((p) => this.groupIdOf(p.idUnite) === groupId)
        .map((p) => p.idModele);
      this.selectOnBoard(unitIds);
    } else {
      this.lastTap = tap;
      // RG_30: saisir un token de la sélection la déplace en bloc ; saisir un
      // autre token la remplace par lui seul (RG_04).
      if (!this.selection().has(token.placement.idModele)) {
        this.selectOnBoard([token.placement.idModele]);
      }
    }
    if (this.selectedCount() > 1) {
      this.startGroupDrag(event, token);
      return;
    }
    this.drag = {
      kind: 'move',
      idModele: token.placement.idModele,
      pointerId: event.pointerId,
      grabOffset: point
        ? { x: token.placement.x - point.x, y: token.placement.y - point.y }
        : { x: 0, y: 0 },
      startRotation: token.placement.rotation,
      startAngle: 0,
      idUnite: token.placement.idUnite,
      groupId: this.groupIdOf(token.placement.idUnite),
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: this.groupCoherent(this.groupIdOf(token.placement.idUnite), this.placements()),
      // RT_34: le token posé suit déjà le doigt par ses coordonnées RT_04 —
      // seul le cercle de visée s'y ajoute, pour rester lisible sous le doigt.
      ghost: this.ghostMetrics(
        token.rx * 2,
        token.ry * 2,
        token.shapeKind,
        token.color,
        token.placement.rotation,
        false,
      ),
      ruler: this.rulerMode(),
    };
    this.grabbedModelId.set(token.placement.idModele);
    // RG_29: la zone visible est masquée tant que le token suit le doigt.
    this.gestureActive.set(true);
    this.trackGhost(this.drag, event);
  }

  /**
   * RG_20/RT_22: poignée de rotation du token sélectionné. La rotation se
   * manipule indépendamment de la position : seul le champ `rotation` de
   * l'enregistrement est modifié, `x`/`y` restent intacts.
   */
  onRotatePointerDown(event: PointerEvent, token: TokenView): void {
    event.preventDefault();
    event.stopPropagation();
    this.capturePointer(event);
    const point = this.toAssetCoords(event);
    this.drag = {
      kind: 'rotate',
      idModele: token.placement.idModele,
      pointerId: event.pointerId,
      grabOffset: { x: 0, y: 0 },
      startRotation: token.placement.rotation,
      startAngle: point
        ? this.angleTo(token.placement, point)
        : token.placement.rotation,
      idUnite: token.placement.idUnite,
      groupId: this.groupIdOf(token.placement.idUnite),
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: this.groupCoherent(this.groupIdOf(token.placement.idUnite), this.placements()),
      // RT_34: la rotation ne déplace pas le token — aucun retour de glisser
      // n'est affiché, la poignée elle-même suivant le doigt.
      ghost: this.ghostMetrics(token.rx * 2, token.ry * 2, token.shapeKind, token.color, 0, false),
    };
    // RG_29: la rotation change ce que voit un socle non circulaire ; la zone
    // est recalculée au relâchement.
    this.gestureActive.set(true);
  }

  private angleTo(center: { x: number; y: number }, point: { x: number; y: number }): number {
    return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
  }

  onPointerMove(event: PointerEvent): void {
    // RT_48: un déplacement de vue ne concerne aucun autre geste.
    if (this.trackViewPan(event)) return;
    // RG_33/RT_42: le second point suit le doigt, borné au rectangle de jeu.
    const ruler = this.rulerDrag;
    if (ruler && ruler.pointerId === event.pointerId) {
      const point = this.toAssetCoords(event);
      const measure = this.measure();
      if (point && measure) this.measure.set({ ...measure, to: this.clamp(point.x, point.y) });
      return;
    }
    const marquee = this.marqueeState;
    if (marquee && marquee.pointerId === event.pointerId) {
      const point = this.toAssetCoords(event);
      if (point) this.marquee.set({ x1: marquee.start.x, y1: marquee.start.y, x2: point.x, y2: point.y });
      return;
    }
    // RT_41: un glissé de plus de 10 px — défilement de la rangée compris —
    // n'est plus l'un des deux appuis d'un double appui sur le bandeau.
    if (this.lastBandTap && Math.hypot(event.clientX - this.lastBandTap.x, event.clientY - this.lastBandTap.y) > 10) {
      this.lastBandTap = null;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = this.toAssetCoords(event);
    if (!point) return;

    // RT_34: le retour visuel suit le doigt du premier contact au relâchement.
    if (drag.kind !== 'rotate') this.trackGhost(drag, event);

    if (drag.kind === 'rotate') {
      const placement = this.placements().find((p) => p.idModele === drag.idModele);
      if (!placement) return;
      const delta = this.angleTo(placement, point) - drag.startAngle;
      const rotation = this.normalizeAngle(drag.startRotation + delta);
      this.updatePlacement(drag.idModele, { rotation });
      // RT_36: la rotation suit le même contrôle que le déplacement ; le
      // refus se lit sur le token avant le relâchement.
      const allowed = this.keepsCoherency(drag, { ...placement, rotation });
      this.refusedModelId.set(allowed ? null : drag.idModele);
      return;
    }

    // RT_40: un glissé de plus de 10 px n'est plus l'un des deux appuis d'un double clic.
    if (this.lastTap && Math.hypot(event.clientX - this.lastTap.x, event.clientY - this.lastTap.y) > 10) {
      this.lastTap = null;
    }

    if (drag.kind === 'group') {
      this.groupOffset.set(this.groupDelta(drag, point));
      return;
    }

    if (drag.kind === 'move') {
      this.updatePlacement(drag.idModele, this.clamp(point.x + drag.grabOffset.x, point.y + drag.grabOffset.y));
    }
    // Pour un nouveau token, rien n'est écrit avant le relâchement : le
    // placement n'existe qu'au drop sur le plateau.
  }

  onPointerUp(event: PointerEvent): void {
    if (this.endViewPan(event)) return;
    const ruler = this.rulerDrag;
    if (ruler && ruler.pointerId === event.pointerId) {
      this.rulerDrag = null;
      // RG_33: le second point est fixé au relâchement, et le tracé reste.
      const point = this.toAssetCoords(event);
      const measure = this.measure();
      if (point && measure) this.measure.set({ ...measure, to: this.clamp(point.x, point.y) });
      this.settleMeasure();
      return;
    }
    const marquee = this.marqueeState;
    if (marquee && marquee.pointerId === event.pointerId) {
      this.marqueeState = null;
      this.finishMarquee(marquee, event);
      return;
    }
    const drag = this.drag;
    this.drag = null;
    this.groupOffset.set(null);
    this.groupRefused.set(false);
    // RT_34: le geste est terminé — le retour visuel disparaît avec lui, quelle
    // qu'ait été son issue (placement créé, déplacement, dépôt refusé).
    this.dragGhost.set(null);
    this.grabbedModelId.set(null);
    this.clusterGrabbed.set(false);
    this.refusedModelId.set(null);
    // RG_29: la zone visible sera recalculée sur la position finale — celle
    // d'avant le geste si la cohésion l'a fait refuser (RT_36), ce qui se
    // règle plus bas, avant tout rendu.
    this.gestureActive.set(false);
    if (!drag || drag.pointerId !== event.pointerId) return;
    // RG_34: le segment reste affiché à la position finale, jusqu'au prochain appui.
    if (drag.ruler) this.settleMeasure();

    if (drag.kind === 'group' && drag.group) {
      // RG_30/RT_40: tout ou rien, en une seule écriture pour tout le groupe.
      const point = this.toAssetCoords(event);
      const board = this.board();
      if (!point || !board || !this.groupMoveAllowed(drag, point, board)) return;
      const { dx, dy } = this.groupDelta(drag, point);
      if (Math.hypot(dx, dy) * this.scale() < 3) {
        // Simple appui sur un token de la sélection : elle se réduit à lui,
        // sauf s'il s'agit du second appui d'un double clic (RG_31).
        if (this.lastTap?.id === drag.idModele) this.selectOnBoard([drag.idModele]);
        return;
      }
      const ids = drag.group.ids;
      this.mutatePlacements((placements) =>
        placements.map((p) => (ids.has(p.idModele) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
      );
      return;
    }

    if (drag.kind === 'cluster') {
      this.dropCluster(drag, event);
      return;
    }

    if (drag.kind !== 'new') {
      // RT_36: un déplacement ou une rotation qui romprait la cohésion est
      // refusé — le token reprend sa position et son orientation d'avant.
      const placement = this.placements().find((p) => p.idModele === drag.idModele);
      // RG_35/RT_44: un déplacement en mode « Règle » n'est jamais rétabli
      // pour perte de cohésion ; la rotation, elle, garde son contrôle.
      const freeMove = drag.kind === 'move' && drag.ruler;
      if (placement && !freeMove && !this.keepsCoherency(drag, placement)) {
        this.updatePlacement(drag.idModele, { ...drag.startPosition, rotation: drag.startRotation });
      }
      return;
    }

    const point = this.toAssetCoords(event);
    const board = this.board();
    const deploymentGroup = this.selectedGroup();
    // RG_38: hors de la partie affichée du plateau, rien n'est posé.
    if (!point || !board || !deploymentGroup || !this.isInsideView(event)) return;

    // Drop hors du plateau, ou rompant la cohésion (RG_26) : aucun placement
    // créé — issue déjà annoncée par le retour visuel (RT_34/RT_36).
    if (!this.gestureAllowed(drag, point, board)) return;

    const clamped = this.clamp(point.x, point.y);

    // RG_15: le bandeau ne propose que des modèles non encore placés, mais
    // deux dépôts très rapprochés peuvent partir du même bouton avant que la
    // rangée n'ait été re-rendue — le second viserait alors un modèle déjà
    // posé. RT_04 veut un enregistrement par modèle : on repositionne, on ne
    // duplique pas.
    if (this.placements().some((p) => p.idModele === drag.idModele)) {
      this.updatePlacement(drag.idModele, clamped);
      return;
    }

    // RT_04: un enregistrement indépendant par modèle.
    this.mutatePlacements((placements) => [
      ...placements,
      { idUnite: drag.idUnite, idModele: drag.idModele, x: clamped.x, y: clamped.y, rotation: 0 },
    ]);

    // RG_15: l'unité qui vient d'être complétée n'est plus proposée par le
    // bandeau — on enchaîne sur la suivante encore en attente plutôt que
    // d'afficher une liste vide. S'il n'en reste aucune, stepUnit ne bouge pas.
    // RG_37: avance quand toute l'unité attachée est posée.
    if (isGroupDeployed(deploymentGroup, this.placements(), this.reservedUnits())) this.stepUnit(1);
  }

  /**
   * RG_33/RG_34: fin d'un tracé. Un simple appui (moins de 3 px à l'écran)
   * ne mesure rien et n'en laisse aucun ; sinon la mesure est annoncée aux
   * technologies d'assistance (RT_43), une fois, au relâchement.
   */
  private settleMeasure(): void {
    const measure = this.measure();
    if (!measure) return;
    const moved = Math.hypot(measure.to.x - measure.from.x, measure.to.y - measure.from.y) * this.scale();
    if (moved < 3) {
      this.measure.set(null);
      return;
    }
    const label = formatInches(measureInches(measure.from, measure.to, this.pixelsPerMm()));
    this.measureAnnouncement.set(measure.refused ? `Déplacement refusé, distance tentée ${label}` : `Mesure ${label}`);
  }

  /**
   * RG_32/RT_41: dépôt de la grappe — tous les placements en une seule
   * écriture (RG_07), ou aucun. Un refus conserve la sélection du bandeau.
   */
  private dropCluster(drag: DragState, event: PointerEvent): void {
    const point = this.toAssetCoords(event);
    const board = this.board();
    const deploymentGroup = this.selectedGroup();
    // RG_38: hors de la partie affichée du plateau, rien n'est posé.
    if (!point || !board || !deploymentGroup || !this.isInsideView(event)) return;
    if (!this.clusterAllowed(drag, point, board)) return;

    // RT_04: un enregistrement par modèle, jamais dupliqué (voir le dépôt simple).
    const placed = new Set(this.placements().map((p) => p.idModele));
    const created = this.clusterPlacements(drag, point).filter((p) => !placed.has(p.idModele));
    if (created.length === 0) return;
    this.mutatePlacements((placements) => [...placements, ...created]);

    // RG_32/RT_41: les tokens créés deviennent la sélection du plateau (RG_30).
    this.bandSelection.set(new Set());
    this.selection.set(new Set(created.map((p) => p.idModele)));

    // RG_15: avance automatique, comme après la pose du dernier modèle.
    if (isGroupDeployed(deploymentGroup, this.placements(), this.reservedUnits())) this.stepUnit(1);
  }

  private isInsideBoard(point: { x: number; y: number }, board: Board): boolean {
    return (
      point.x >= board.playArea.left &&
      point.x <= board.playArea.right &&
      point.y >= board.playArea.top &&
      point.y <= board.playArea.bottom
    );
  }

  private clamp(x: number, y: number): { x: number; y: number } {
    const board = this.board();
    return board ? clampToPlayArea(board, x, y) : { x, y };
  }

  private normalizeAngle(angle: number): number {
    return Math.round(((angle % 360) + 360) % 360);
  }

  /** RG_20: rotation au pas fixe, complément tactile de la poignée. */
  rotateSelected(delta: number): void {
    const id = this.selectedPlacementId();
    const placement = id ? this.placements().find((p) => p.idModele === id) : undefined;
    if (!placement) return;
    const rotation = this.normalizeAngle(placement.rotation + delta);
    // RG_26/RT_36: même contrôle que la poignée de rotation, sur une unité en
    // cohésion avant le geste.
    const placements = this.placements();
    const rotated = placements.map((p) => (p === placement ? { ...p, rotation } : p));
    const groupId = this.groupIdOf(placement.idUnite);
    if (this.groupCoherent(groupId, placements) && !this.groupCoherent(groupId, rotated)) {
      void this.announceRefusal('Rotation refusée : l’unité ne serait plus en cohésion.');
      return;
    }
    this.updatePlacement(placement.idModele, { rotation });
  }

  /**
   * Retire un token du plateau (le modèle repasse « en attente », RG_05).
   *
   * RG_26/RT_36: si ce retrait coupe la chaîne de contiguïté d'une unité qui
   * était en cohésion, les tokens des groupes détachés sont retirés avec lui
   * — le groupe le plus nombreux reste sur le plateau. Retirant plus que le
   * token choisi, l'opération est confirmée (même principe que RG_08) ;
   * l'annuler ne retire rien.
   */
  async removeSelected(): Promise<void> {
    const id = this.selectedPlacementId();
    const placements = this.placements();
    const placement = placements.find((p) => p.idModele === id);
    if (!placement) return;

    const remaining = placements.filter((p) => p !== placement);
    // RG_37: le plus grand groupe conservé est celui de l'unité attachée entière.
    const groupId = this.groupIdOf(placement.idUnite);
    const detached = this.groupCoherent(groupId, placements)
      ? detachedAfterRemoval(this.groupBases(groupId, remaining))
      : [];

    if (detached.length > 0) {
      const alert = await this.alerts.create({
        header: 'Retirer ce token ?',
        message:
          `Ce retrait coupe l'unité en plusieurs groupes. Pour qu'elle reste en ` +
          `cohésion, ${detached.length} token(s) supplémentaire(s) seront retirés ` +
          `du plateau ; le groupe le plus nombreux est conservé.`,
        buttons: [
          { text: 'Annuler', role: 'cancel' },
          { text: 'Retirer', role: 'destructive' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'destructive') return;
    }

    // RT_36: token choisi et groupes détachés disparaissent dans la même écriture.
    const removed = new Set([placement.idModele, ...detached]);
    this.mutatePlacements((current) => current.filter((p) => !removed.has(p.idModele)));
    this.selection.set(new Set());
  }

  private updatePlacement(idModele: string, patch: Partial<Pick<Placement, 'x' | 'y' | 'rotation'>>): void {
    this.mutatePlacements((placements) =>
      placements.map((placement) =>
        placement.idModele === idModele ? { ...placement, ...patch } : placement,
      ),
    );
  }

  /**
   * EX_04/RG_07: chaque mutation met à jour l'état affiché puis programme un
   * enregistrement de l'état courant. La sauvegarde reflète donc la saisie en
   * continu, y compris un déploiement encore incomplet.
   */
  private mutatePlacements(update: (placements: readonly Placement[]) => Placement[]): void {
    const deployment = this.deployment();
    if (!deployment) return;
    this.deployment.set({ ...deployment, placements: update(deployment.placements) });
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // Léger regroupement des écritures pendant un glisser continu ; l'état
    // n'est jamais perdu, la sortie d'écran force l'enregistrement.
    this.saveTimer = setTimeout(() => void this.save(), 250);
  }

  private async save(): Promise<void> {
    const deployment = this.deployment();
    if (!deployment) return;
    const saved = await this.library.saveDeployment(deployment);
    // On conserve l'horodatage renvoyé sans écraser des placements plus
    // récents saisis entre-temps.
    this.deployment.set({ ...this.deployment()!, updatedAt: saved.updatedAt, dirty: saved.dirty });
  }

  /** RG_07: « enregistrer sous un nouveau nom » crée une entrée distincte. */
  async saveAsNew(): Promise<void> {
    const deployment = this.deployment();
    if (!deployment) return;
    const alert = await this.alerts.create({
      header: 'Enregistrer sous un nouveau nom',
      message: 'Le déploiement courant est conservé ; une copie indépendante sera créée.',
      inputs: [{ name: 'name', type: 'text', value: `${deployment.name} (copie)` }],
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Enregistrer',
          handler: (data: { name?: string }) => {
            const name = data.name?.trim();
            if (name) void this.library.saveDeploymentAs(deployment, name);
          },
        },
      ],
    });
    await alert.present();
  }

  async back(): Promise<void> {
    // RG_35: quitter mode « Règle » actif équivaut à le désactiver ; la garde
    // de route (RT_44) couvre aussi le retour système.
    if (!(await this.canLeave())) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.save();
    await this.router.navigate([
      '/list',
      this.listId(),
      'adversary',
      this.opponentId(),
      'boards',
    ]);
  }

  /** Libellé du groupe de socles affiché par le menu unités (RG_16). */
  shapeLabel(group: UnitModelGroup): string {
    return this.shapeOf(group)?.label ?? 'socle non assigné';
  }

  shapeOf(group: UnitModelGroup): BaseShape | undefined {
    return resolveGroupShape(group, this.shapes());
  }
}
