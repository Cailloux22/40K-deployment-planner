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
  isUnitDeployed,
  modelIdsOfGroup,
  placedModelIds,
  reservedUnitIds,
  unitMenuViews,
} from '../../deployment/deployment-status';
import {
  assetPixelsPerMm,
  clampToPlayArea,
  MM_PER_INCH,
  containFitScale,
  resolveGroupShape,
  tokenSize,
} from '../../deployment/token-geometry';
import { clusterLayout } from '../../deployment/cluster';
import { BaseFootprint } from '../../deployment/geometry';
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
  readonly group: UnitModelGroup;
  readonly shape?: BaseShape;
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
}

type DragKind = 'new' | 'move' | 'rotate' | 'group' | 'cluster';

/** RG_32/RT_41: un socle de la grappe, relatif à son centre, en pixels CSS. */
interface GhostMember {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly shapeKind: BaseShapeKind;
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
  /** Unité du modèle saisi — celle dont la cohésion est contrôlée (RG_26). */
  readonly idUnite: string;
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
  /** RG_30/RT_40: tokens déplacés ensemble, et unités en cohésion à la saisie. */
  readonly group?: {
    readonly ids: ReadonlySet<string>;
    readonly coherentUnits: ReadonlySet<string>;
  };
  /**
   * RG_32/RT_41: modèles du bandeau posés ensemble, avec leur décalage au
   * centre de la grappe en pixels d'asset — figé à la saisie.
   */
  readonly cluster?: readonly { readonly idModele: string; readonly dx: number; readonly dy: number }[];
}

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
 * disponible, à un zoom fixe calculé par ajustement « contenir ». Ce zoom
 * n'est ni réglable ni déplaçable par le joueur : aucun pincer-zoomer, aucun
 * pan, aucun défilement du plateau. Seuls les tokens sont manipulables.
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

  readonly board = signal<Board | undefined>(undefined);
  readonly deployment = signal<Deployment | undefined>(undefined);
  readonly selectedUnitIndex = signal(0);
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
  /** RT_19: échelle d'affichage, recalculée sur changement d'espace disponible. */
  readonly scale = signal(0);
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

  readonly selectedUnit = computed<ArmyUnit | undefined>(
    () => this.list()?.units[this.selectedUnitIndex()],
  );

  readonly placements = computed<readonly Placement[]>(() => this.deployment()?.placements ?? []);

  /** RG_25/RT_35: unités déclarées en réserve sur ce déploiement. */
  readonly reservedUnits = computed<ReadonlySet<string>>(() => reservedUnitIds(this.deployment()));

  /** RG_25: état de la case à cocher du bandeau, pour l'unité courante. */
  readonly selectedUnitReserved = computed(() => {
    const unit = this.selectedUnit();
    return !!unit && this.reservedUnits().has(unit.id);
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
    const unit = this.selectedUnit();
    // RG_25: une unité en réserve n'a aucun modèle à poser sur le plateau.
    if (!unit || this.reservedUnits().has(unit.id)) return [];
    const placed = placedModelIds(this.placements(), unit.id);
    const shapes = this.shapes();
    return unit.modelGroups.flatMap((group) =>
      modelIdsOfGroup(group)
        .filter((idModele) => !placed.has(idModele))
        .map((idModele) => ({
          idModele,
          group,
          // RT_28: un rectangle sur mesure se rend comme n'importe quel socle.
          shape: resolveGroupShape(group, shapes),
        })),
    );
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
    const unit = this.selectedUnit();
    if (!unit) return BAND_PIXELS_PER_MM;
    const shapes = this.shapes();
    // RG_15/RT_33: l'échelle se mesure sur *tous* les socles de l'unité, y
    // compris ceux déjà posés et donc sortis du bandeau — sinon le départ du
    // plus grand socle ferait grandir d'un coup les modèles restants.
    const largestMm = unit.modelGroups.reduce((max, group) => {
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
    const unit = this.selectedUnit();
    if (!unit) return 0;
    return unit.modelCount - placedModelIds(this.placements(), unit.id).size;
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
   * RG_05/RG_15: rangs, dans la liste, des unités ayant encore au moins un
   * modèle à poser — les seules que les flèches du bandeau parcourent.
   */
  private readonly pendingUnitIndexes = computed<readonly number[]>(() => {
    const list = this.list();
    if (!list) return [];
    const placements = this.placements();
    // RG_25: une unité en réserve est déployée — les flèches ne s'y arrêtent
    // plus, exactement comme sur une unité dont tous les modèles sont posés.
    const reserved = this.reservedUnits();
    const indexes: number[] = [];
    list.units.forEach((unit, index) => {
      if (!isUnitDeployed(unit, placements, reserved)) indexes.push(index);
    });
    return indexes;
  });

  async ngOnInit(): Promise<void> {
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
    if (firstPending !== undefined) this.selectedUnitIndex.set(firstPending);

    this.observeAvailableSpace();
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
      this.scale.set(
        containFitScale(
          { width: host.clientWidth, height: host.clientHeight },
          // RT_19: le facteur se calcule sur le rectangle de jeu mesuré
          // (`playArea`), pas sur l'image entière.
          { width: board.playArea.width, height: board.playArea.height },
        ),
      );
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
    const count = this.list()?.units.length ?? 0;
    const pending = this.pendingUnitIndexes();
    if (count === 0 || pending.length === 0) return;
    const current = this.selectedUnitIndex();
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
    const index = this.list()?.units.findIndex((unit) => unit.id === view.unit.id) ?? -1;
    if (index >= 0) this.selectUnitIndex(index);
    this.menuOpen.set(false);
  }

  /**
   * RG_15: bascule le bandeau sur une unité. RG_32/RT_41: la sélection du
   * bandeau ne survit pas au changement d'unité.
   */
  private selectUnitIndex(index: number): void {
    if (index !== this.selectedUnitIndex()) this.bandSelection.set(new Set());
    this.selectedUnitIndex.set(index);
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
    const unitId = soleSelectedUnit(this.placements(), selection);
    if (unitId === null) return;
    const index = this.list()?.units.findIndex((unit) => unit.id === unitId) ?? -1;
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
    const unit = this.selectedUnit();
    const wanted = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    if (!unit || !this.deployment() || wanted === this.reservedUnits().has(unit.id)) {
      checkbox.checked = this.selectedUnitReserved();
      return;
    }

    const placed = placedModelIds(this.placements(), unit.id).size;
    if (!wanted || placed === 0) {
      this.setReserved(unit, wanted);
      checkbox.checked = this.selectedUnitReserved();
      return;
    }

    const alert = await this.alerts.create({
      header: 'Mettre cette unité en réserve ?',
      message:
        `${placed} modèle(s) de « ${unit.name} » sont posés sur le plateau. ` +
        `Une unité en réserve n'a aucun token sur le plateau : ces placements ` +
        `seront définitivement retirés.`,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        { text: 'Mettre en réserve', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') this.setReserved(unit, true);
    checkbox.checked = this.selectedUnitReserved();
  }

  /**
   * RT_35: la réserve est enregistrée sur le déploiement, à côté des
   * placements — aucun placement n'est fabriqué pour une unité réservée, et
   * ceux qu'elle avait sont retirés (RG_25). EX_04/RG_07: l'écriture est
   * continue, comme pour un placement.
   */
  private setReserved(unit: ArmyUnit, reserved: boolean): void {
    const deployment = this.deployment();
    if (!deployment) return;

    const ids = new Set(deployment.reservedUnitIds ?? []);
    if (reserved) ids.add(unit.id);
    else ids.delete(unit.id);
    // RG_32: la mise en réserve vide le bandeau, et sa sélection avec lui.
    this.bandSelection.set(new Set());

    const placements = reserved
      ? deployment.placements.filter((placement) => placement.idUnite !== unit.id)
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

  /**
   * RT_36: socles posés d'une unité, en pouces réels, dans l'ordre des
   * placements — donc des dépôts, que suit le départage de RG_26 au retrait.
   */
  private unitBases(idUnite: string, placements: readonly Placement[]): CoherencyBase[] {
    const groupShape = this.groupShapes();
    const perMm = this.pixelsPerMm();
    const bases: CoherencyBase[] = [];
    for (const placement of placements) {
      if (placement.idUnite !== idUnite) continue;
      const shape = groupShape.get(placement.idModele.split('#')[0]);
      if (shape) bases.push(coherencyBase(placement, shape, perMm));
    }
    return bases;
  }

  private unitCoherent(idUnite: string, placements: readonly Placement[]): boolean {
    return isCoherent(this.unitBases(idUnite, placements));
  }

  /**
   * RG_26: le geste en cours, s'il aboutissait avec `candidate` comme
   * placement du modèle saisi, laisserait-il l'unité en cohésion ? Une unité
   * déjà hors cohésion au début du geste n'est pas contrôlée.
   */
  private keepsCoherency(drag: DragState, candidate: Placement): boolean {
    if (!drag.wasCoherent) return true;
    const others = this.placements().filter((placement) => placement.idModele !== candidate.idModele);
    return this.unitCoherent(drag.idUnite, [...others, candidate]);
  }

  /** RG_26: l'issue refusée d'un geste sans retour de glisser est annoncée. */
  private async announceRefusal(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2500, position: 'top' });
    await toast.present();
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
    const droppable = !!point && !!board && this.gestureAllowed(drag, point, board);
    // RT_36: un token posé dont le déplacement serait refusé le montre aussi.
    if (drag.kind === 'move') this.refusedModelId.set(droppable ? null : drag.idModele);
    if (drag.kind === 'group') this.groupRefused.set(!droppable);
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
    // RG_26: seules les unités en cohésion à la saisie sont contrôlées.
    return [...group.coherentUnits].every((idUnite) => this.unitCoherent(idUnite, moved));
  }

  /**
   * RG_30/RT_40: début du glissement d'un token appartenant à une sélection
   * multiple — tous les tokens sélectionnés suivent le même vecteur.
   */
  private startGroupDrag(event: PointerEvent, token: TokenView): void {
    const ids = new Set(this.tokens().filter((t) => t.selected).map((t) => t.placement.idModele));
    const placements = this.placements();
    const units = new Set(placements.filter((p) => ids.has(p.idModele)).map((p) => p.idUnite));
    const coherentUnits = new Set([...units].filter((idUnite) => this.unitCoherent(idUnite, placements)));
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
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: true,
      ghost: this.ghostMetrics(token.rx * 2, token.ry * 2, token.shapeKind, token.color, token.placement.rotation, false),
      group: { ids, coherentUnits },
    };
    this.grabbedModelId.set(token.placement.idModele);
    this.gestureActive.set(true);
    this.groupOffset.set({ dx: 0, dy: 0 });
    this.trackGhost(this.drag, event);
  }

  /**
   * RG_30/RT_40: un appui sur le fond du plateau commence un rectangle de
   * sélection. Le plateau n'ayant ni pan ni zoom (RG_17), le geste n'entre en
   * concurrence avec aucun autre.
   */
  onBoardPointerDown(event: PointerEvent): void {
    const point = this.toAssetCoords(event);
    if (!point) return;
    event.preventDefault();
    this.capturePointer(event);
    // RG_32: un appui sur le plateau annule la sélection du bandeau.
    this.bandSelection.set(new Set());
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
    const unit = this.selectedUnit();
    if (!model.shape || !unit) return;
    event.preventDefault();
    // RT_41: l'appui est compté ici, pas une seconde fois par le corps du bandeau.
    event.stopPropagation();
    this.capturePointer(event);
    // RG_32/RT_41: le second appui d'un double appui sélectionne tout le
    // bandeau ; saisir un modèle de cette sélection emporte la grappe.
    if (this.registerBandTap(event)) this.selectWholeBand();
    if (this.bandSelection().has(model.idModele) && this.bandSelectedCount() > 1) {
      this.startClusterDrag(event, unit);
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
      idUnite: unit.id,
      startPosition: { x: 0, y: 0 },
      wasCoherent: this.unitCoherent(unit.id, this.placements()),
      // RT_34: le token provisoire est celui qui sera posé — même forme (RT_26),
      // même couleur d'unité (RG_06), même taille à l'écran (RT_05).
      ghost: this.ghostMetrics(
        size.width,
        size.height,
        model.shape.shape,
        this.selectedUnit()?.color ?? UNIT_COLOR_FALLBACK,
        0,
        true,
      ),
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
  private startClusterDrag(event: PointerEvent, unit: ArmyUnit): void {
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
      return { idModele: model.idModele, dx: offset.x * MM_PER_INCH * perMm, dy: offset.y * MM_PER_INCH * perMm };
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
      idUnite: unit.id,
      startPosition: { x: 0, y: 0 },
      // RG_26: une unité déjà hors cohésion n'est pas contrôlée.
      wasCoherent: this.unitCoherent(unit.id, this.placements()),
      ghost: {
        box: Math.max(DRAG_AIM_RADIUS_PX, envelope) * 2 + 8,
        width: 0,
        height: 0,
        rotation: 0,
        shapeKind: 'round',
        color: unit.color ?? UNIT_COLOR_FALLBACK,
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
      idUnite: drag.idUnite,
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
    return this.unitCoherent(drag.idUnite, [...this.placements(), ...candidates]);
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
      const unitIds = this.placements()
        .filter((p) => p.idUnite === token.placement.idUnite)
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
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: this.unitCoherent(token.placement.idUnite, this.placements()),
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
      startPosition: { x: token.placement.x, y: token.placement.y },
      wasCoherent: this.unitCoherent(token.placement.idUnite, this.placements()),
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
      if (placement && !this.keepsCoherency(drag, placement)) {
        this.updatePlacement(drag.idModele, { ...drag.startPosition, rotation: drag.startRotation });
      }
      return;
    }

    const point = this.toAssetCoords(event);
    const board = this.board();
    const unit = this.selectedUnit();
    if (!point || !board || !unit) return;

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
      { idUnite: unit.id, idModele: drag.idModele, x: clamped.x, y: clamped.y, rotation: 0 },
    ]);

    // RG_15: l'unité qui vient d'être complétée n'est plus proposée par le
    // bandeau — on enchaîne sur la suivante encore en attente plutôt que
    // d'afficher une liste vide. S'il n'en reste aucune, stepUnit ne bouge pas.
    if (isUnitDeployed(unit, this.placements(), this.reservedUnits())) this.stepUnit(1);
  }

  /**
   * RG_32/RT_41: dépôt de la grappe — tous les placements en une seule
   * écriture (RG_07), ou aucun. Un refus conserve la sélection du bandeau.
   */
  private dropCluster(drag: DragState, event: PointerEvent): void {
    const point = this.toAssetCoords(event);
    const board = this.board();
    const unit = this.selectedUnit();
    if (!point || !board || !unit || !this.clusterAllowed(drag, point, board)) return;

    // RT_04: un enregistrement par modèle, jamais dupliqué (voir le dépôt simple).
    const placed = new Set(this.placements().map((p) => p.idModele));
    const created = this.clusterPlacements(drag, point).filter((p) => !placed.has(p.idModele));
    if (created.length === 0) return;
    this.mutatePlacements((placements) => [...placements, ...created]);

    // RG_32/RT_41: les tokens créés deviennent la sélection du plateau (RG_30).
    this.bandSelection.set(new Set());
    this.selection.set(new Set(created.map((p) => p.idModele)));

    // RG_15: avance automatique, comme après la pose du dernier modèle.
    if (isUnitDeployed(unit, this.placements(), this.reservedUnits())) this.stepUnit(1);
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
    if (this.unitCoherent(placement.idUnite, placements) && !this.unitCoherent(placement.idUnite, rotated)) {
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
    const detached = this.unitCoherent(placement.idUnite, placements)
      ? detachedAfterRemoval(this.unitBases(placement.idUnite, remaining))
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
