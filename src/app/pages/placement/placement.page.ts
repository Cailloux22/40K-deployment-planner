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
import { AlertController } from '@ionic/angular/lazy';

import { LibraryService } from '../../data/library.service';
import {
  UnitMenuView,
  modelIdsOfGroup,
  placedModelIds,
  unitMenuViews,
} from '../../deployment/deployment-status';
import { assetPixelsPerMm, clampToPlayArea, containFitScale, tokenSize } from '../../deployment/token-geometry';
import { ArmyList, ArmyUnit, Deployment, Placement, UnitModelGroup } from '../../models/domain.models';
import { BaseShape, Board, BoardReferential } from '../../models/referential.models';
import { ReferentialService } from '../../referentials/referential.service';

/** Un modèle individuel de l'unité courante, tel que listé par le bandeau. */
interface BandModel {
  readonly idModele: string;
  readonly group: UnitModelGroup;
  readonly shape?: BaseShape;
  readonly placed: boolean;
}

/** Un token posé sur le plateau, prêt à être rendu en SVG. */
interface TokenView {
  readonly placement: Placement;
  readonly color: string;
  readonly rx: number;
  readonly ry: number;
  readonly selected: boolean;
}

type DragKind = 'new' | 'move' | 'rotate';

interface DragState {
  readonly kind: DragKind;
  readonly idModele: string;
  readonly pointerId: number;
  /** Écart entre le centre du token et le doigt, en coordonnées d'asset. */
  readonly grabOffset: { x: number; y: number };
  readonly startRotation: number;
  readonly startAngle: number;
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
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('boardArea') boardArea?: ElementRef<HTMLElement>;
  @ViewChild('boardSurface') boardSurface?: ElementRef<HTMLElement>;

  private readonly listId = signal('');
  private readonly opponentId = signal('');
  private readonly boardId = signal('');
  private readonly boardReferential = signal<BoardReferential | undefined>(undefined);
  private readonly shapes = signal<ReadonlyMap<string, BaseShape>>(new Map());
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

  readonly list = computed<ArmyList | undefined>(() => this.library.list(this.listId()));

  readonly selectedUnit = computed<ArmyUnit | undefined>(
    () => this.list()?.units[this.selectedUnitIndex()],
  );

  readonly placements = computed<readonly Placement[]>(() => this.deployment()?.placements ?? []);

  /** RT_05: pixels d'asset par millimètre réel du socle. */
  readonly pixelsPerMm = computed(() => {
    const board = this.board();
    const referential = this.boardReferential();
    return board && referential ? assetPixelsPerMm(board, referential) : 1;
  });

  /**
   * RG_15/RT_17: la liste des modèles individuels de l'unité sélectionnée.
   * Un modèle déjà placé y reste visible — pour permettre son
   * repositionnement — mais visuellement distingué (RG_05).
   */
  readonly bandModels = computed<readonly BandModel[]>(() => {
    const unit = this.selectedUnit();
    if (!unit) return [];
    const placed = placedModelIds(this.placements(), unit.id);
    const shapes = this.shapes();
    return unit.modelGroups.flatMap((group) =>
      modelIdsOfGroup(group).map((idModele) => ({
        idModele,
        group,
        shape: group.baseShapeId ? shapes.get(group.baseShapeId) : undefined,
        placed: placed.has(idModele),
      })),
    );
  });

  readonly remainingInUnit = computed(() => {
    const unit = this.selectedUnit();
    if (!unit) return 0;
    return unit.modelCount - placedModelIds(this.placements(), unit.id).size;
  });

  /** RG_16/RT_18: vue du menu unités — groupes de socles, comptes et statuts. */
  readonly menuViews = computed<readonly UnitMenuView[]>(() => {
    const list = this.list();
    return list ? unitMenuViews(list, this.placements()) : [];
  });

  readonly tokens = computed<readonly TokenView[]>(() => {
    const list = this.list();
    if (!list) return [];

    const shapes = this.shapes();
    const perMm = this.pixelsPerMm();
    const selected = this.selectedPlacementId();

    const groupShape = new Map<string, string | null>();
    const unitColor = new Map<string, string>();
    for (const unit of list.units) {
      unitColor.set(unit.id, unit.color);
      for (const group of unit.modelGroups) groupShape.set(group.id, group.baseShapeId);
    }

    const views: TokenView[] = [];
    for (const placement of this.placements()) {
      const shape = shapes.get(groupShape.get(placement.idModele.split('#')[0]) ?? '');
      if (!shape) continue;
      const size = tokenSize(shape, perMm);
      views.push({
        placement,
        color: unitColor.get(placement.idUnite) ?? '#888888',
        rx: size.width / 2,
        ry: size.height / 2,
        selected: placement.idModele === selected,
      });
    }
    return views;
  });

  readonly selectedToken = computed<TokenView | undefined>(() =>
    this.tokens().find((token) => token.selected),
  );

  /** RG_05: unités dont tous les modèles ne sont pas encore placés. */
  readonly pendingUnits = computed(() => this.menuViews().filter((view) => view.status !== 'green'));

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
          { width: board.width, height: board.height },
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
    const count = this.list()?.units.length ?? 0;
    if (count === 0) return;
    this.selectedUnitIndex.set((this.selectedUnitIndex() - 1 + count) % count);
  }

  nextUnit(): void {
    const count = this.list()?.units.length ?? 0;
    if (count === 0) return;
    this.selectedUnitIndex.set((this.selectedUnitIndex() + 1) % count);
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
    if (!surface || scale <= 0) return null;
    const rect = surface.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  }

  /**
   * RG_15/RT_17: début d'un glisser depuis le bandeau. Le drop créera un
   * enregistrement de placement au sens de RT_04 — un par modèle (RG_04).
   */
  onBandPointerDown(event: PointerEvent, model: BandModel): void {
    if (!model.shape) return;
    event.preventDefault();
    this.capturePointer(event);
    this.drag = {
      kind: 'new',
      idModele: model.idModele,
      pointerId: event.pointerId,
      grabOffset: { x: 0, y: 0 },
      startRotation: 0,
      startAngle: 0,
    };
    this.selectedPlacementId.set(model.idModele);
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
    };
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

    if (drag.kind === 'rotate') {
      const placement = this.placements().find((p) => p.idModele === drag.idModele);
      if (!placement) return;
      const delta = this.angleTo(placement, point) - drag.startAngle;
      this.updatePlacement(drag.idModele, { rotation: this.normalizeAngle(drag.startRotation + delta) });
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
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind !== 'new') return;

    const point = this.toAssetCoords(event);
    const board = this.board();
    const unit = this.selectedUnit();
    if (!point || !board || !unit) return;

    // Drop hors du plateau : aucun placement créé.
    if (!this.isInsideBoard(point, board)) return;

    const clamped = this.clamp(point.x, point.y);
    const existing = this.placements().find((p) => p.idModele === drag.idModele);
    if (existing) {
      // RG_15: un modèle déjà placé est repositionné, pas dupliqué.
      this.updatePlacement(drag.idModele, clamped);
      return;
    }

    // RT_04: un enregistrement indépendant par modèle.
    this.mutatePlacements((placements) => [
      ...placements,
      { idUnite: unit.id, idModele: drag.idModele, x: clamped.x, y: clamped.y, rotation: 0 },
    ]);
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
    this.updatePlacement(placement.idModele, {
      rotation: this.normalizeAngle(placement.rotation + delta),
    });
  }

  /** Retire un token du plateau (le modèle repasse « en attente », RG_05). */
  removeSelected(): void {
    const id = this.selectedPlacementId();
    if (!id) return;
    this.mutatePlacements((placements) => placements.filter((p) => p.idModele !== id));
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
    const shape = group.baseShapeId ? this.shapes().get(group.baseShapeId) : undefined;
    return shape?.label ?? 'socle non assigné';
  }

  shapeOf(group: UnitModelGroup): BaseShape | undefined {
    return group.baseShapeId ? this.shapes().get(group.baseShapeId) : undefined;
  }
}
