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
  containFitScale,
  resolveGroupShape,
  tokenSize,
} from '../../deployment/token-geometry';
import { CoherencyBase, coherencyBase, detachedAfterRemoval, isCoherent } from '../../deployment/unit-coherency';
import { ArmyList, ArmyUnit, Deployment, Placement, UnitModelGroup } from '../../models/domain.models';
import { BaseShape, BaseShapeKind, Board, BoardReferential } from '../../models/referential.models';
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

type DragKind = 'new' | 'move' | 'rotate';

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

  readonly board = signal<Board | undefined>(undefined);
  readonly deployment = signal<Deployment | undefined>(undefined);
  readonly selectedUnitIndex = signal(0);
  readonly selectedPlacementId = signal<string | null>(null);
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
    const selected = this.selectedPlacementId();
    const groupShape = this.groupShapes();
    const unitColor = new Map(list.units.map((unit) => [unit.id, unit.color]));

    const views: TokenView[] = [];
    for (const placement of this.placements()) {
      const shape = groupShape.get(placement.idModele.split('#')[0]);
      if (!shape) continue;
      const size = tokenSize(shape, perMm);
      views.push({
        placement,
        // RT_32: repli unique, partagé avec le visualiseur.
        color: unitColor.get(placement.idUnite) ?? UNIT_COLOR_FALLBACK,
        rx: size.width / 2,
        ry: size.height / 2,
        shapeKind: shape.shape,
        selected: placement.idModele === selected,
      });
    }
    return views;
  });

  readonly selectedToken = computed<TokenView | undefined>(() =>
    this.tokens().find((token) => token.selected),
  );

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
        this.selectedUnitIndex.set(candidate);
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
    if (index >= 0) this.selectedUnitIndex.set(index);
    this.menuOpen.set(false);
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

    const placements = reserved
      ? deployment.placements.filter((placement) => placement.idUnite !== unit.id)
      : deployment.placements;

    this.deployment.set({ ...deployment, placements, reservedUnitIds: [...ids] });

    // Le token sélectionné a pu disparaître avec les placements de l'unité.
    const selected = this.selectedPlacementId();
    if (selected && !placements.some((placement) => placement.idModele === selected)) {
      this.selectedPlacementId.set(null);
    }
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
    const placement = this.placements().find((p) => p.idModele === drag.idModele);
    if (!placement) return true;
    const moved = this.clamp(point.x + drag.grabOffset.x, point.y + drag.grabOffset.y);
    return this.keepsCoherency(drag, { ...placement, ...moved });
  }

  /**
   * RG_15/RT_17: début d'un glisser depuis le bandeau. Le drop créera un
   * enregistrement de placement au sens de RT_04 — un par modèle (RG_04).
   */
  onBandPointerDown(event: PointerEvent, model: BandModel): void {
    const unit = this.selectedUnit();
    if (!model.shape || !unit) return;
    event.preventDefault();
    this.capturePointer(event);
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
    this.selectedPlacementId.set(model.idModele);
    // RT_34: dès le premier contact, le geste se voit — sans quoi rien ne
    // distingue un glisser commencé d'un appui sans effet.
    this.grabbedModelId.set(model.idModele);
    this.trackGhost(this.drag, event);
  }

  /** Déplacement d'un token déjà posé (RG_04 : « déplacer rapidement »). */
  onTokenPointerDown(event: PointerEvent, token: TokenView): void {
    event.preventDefault();
    event.stopPropagation();
    this.capturePointer(event);
    const point = this.toAssetCoords(event);
    this.selectedPlacementId.set(token.placement.idModele);
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
  }

  private angleTo(center: { x: number; y: number }, point: { x: number; y: number }): number {
    return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
  }

  onPointerMove(event: PointerEvent): void {
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

    if (drag.kind === 'move') {
      this.updatePlacement(drag.idModele, this.clamp(point.x + drag.grabOffset.x, point.y + drag.grabOffset.y));
    }
    // Pour un nouveau token, rien n'est écrit avant le relâchement : le
    // placement n'existe qu'au drop sur le plateau.
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    // RT_34: le geste est terminé — le retour visuel disparaît avec lui, quelle
    // qu'ait été son issue (placement créé, déplacement, dépôt refusé).
    this.dragGhost.set(null);
    this.grabbedModelId.set(null);
    this.refusedModelId.set(null);
    if (!drag || drag.pointerId !== event.pointerId) return;

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
    this.selectedPlacementId.set(null);
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
