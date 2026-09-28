import {
  ChangeDetectionStrategy,
  Component,
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
import { boardStatus } from '../../deployment/deployment-status';
import { ArmyList, BoardDeploymentStatus, Deployment } from '../../models/domain.models';
import { BaseShape, Board, ForceDisposition } from '../../models/referential.models';
import { ReferentialService } from '../../referentials/referential.service';

interface BoardSlide {
  readonly board: Board;
  readonly deployment?: Deployment;
  readonly status: BoardDeploymentStatus;
}

const STATUS_LABELS: Record<BoardDeploymentStatus, string> = {
  missing: 'Déploiement manquant',
  unfinished: 'Déploiement non fini',
  done: 'Déploiement fait',
};

/**
 * Écran 4 — Choix du plateau (RG_03 étape 2).
 *
 * RG_14: les 3 plateaux sont présentés un par un dans un pager glissable
 * horizontalement — un seul plateau visible à la fois. Un unique bloc
 * « Statut » et un unique jeu d'actions contextuelles sont affichés en haut à
 * droite, et ne reflètent que le plateau actuellement affiché par le pager.
 *
 * RT_11 étape 2: le statut individuel (rouge / orange / vert) est calculé en
 * filtrant les déploiements locaux sur le triplet (liste, disposition adverse,
 * plateau), sans appel réseau, et recalculé à chaque affichage.
 */
@Component({
  selector: 'app-board-choice',
  templateUrl: 'board-choice.page.html',
  styleUrls: ['board-choice.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardChoicePage implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly referential = inject(ReferentialService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);

  @ViewChild('pager') pager?: ElementRef<HTMLElement>;

  private readonly listId = signal('');
  private readonly opponentId = signal('');
  private readonly boards = signal<readonly Board[]>([]);

  readonly playerDisposition = signal<ForceDisposition | undefined>(undefined);
  readonly opponentDisposition = signal<ForceDisposition | undefined>(undefined);
  readonly shapes = signal<ReadonlyMap<string, BaseShape>>(new Map());

  /** Index du plateau visible dans le pager (RG_14). */
  readonly activeIndex = signal(0);

  /** RT_16: vue plein écran demandée — plateau seul, ou déploiement. */
  readonly viewer = signal<{ variant: 'with-measurements' | 'no-measurements'; board: Board } | null>(
    null,
  );

  readonly list = computed<ArmyList | undefined>(() => this.library.list(this.listId()));

  readonly slides = computed<readonly BoardSlide[]>(() => {
    const list = this.list();
    if (!list) return [];
    return this.boards().map((board) => {
      const deployment = this.library.deploymentFor(list.id, this.opponentId(), board.id);
      return { board, deployment, status: boardStatus(list, deployment) };
    });
  });

  readonly activeSlide = computed<BoardSlide | undefined>(() => this.slides()[this.activeIndex()]);

  readonly statusLabel = computed(() => {
    const slide = this.activeSlide();
    return slide ? STATUS_LABELS[slide.status] : '';
  });

  /** RG_14: « Éditer » n'existe qu'à partir d'un déploiement enregistré. */
  readonly canEdit = computed(() => {
    const status = this.activeSlide()?.status;
    return status === 'unfinished' || status === 'done';
  });

  /**
   * RG_14: « Consulter » n'apparaît qu'au statut vert — un déploiement encore
   * en cours de remplissage se reprend via « Éditer », pas via cette vue en
   * lecture seule.
   */
  readonly canConsult = computed(() => this.activeSlide()?.status === 'done');

  /** RG_14: le bouton « Éditer » passe en orange quand le déploiement est non fini. */
  readonly editColor = computed(() =>
    this.activeSlide()?.status === 'unfinished' ? 'warning' : 'primary',
  );

  readonly viewerPlacements = computed(() => {
    const viewer = this.viewer();
    if (!viewer || viewer.variant !== 'no-measurements') return [];
    return this.activeSlide()?.deployment?.placements ?? [];
  });

  async ngOnInit(): Promise<void> {
    this.listId.set(this.route.snapshot.paramMap.get('listId') ?? '');
    this.opponentId.set(this.route.snapshot.paramMap.get('opponentId') ?? '');
    await this.library.load();

    const list = this.list();
    if (!list) {
      await this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }

    const [player, opponent] = await Promise.all([
      this.referential.disposition(list.forceDispositionId),
      this.referential.disposition(this.opponentId()),
    ]);
    // RG_03: sans disposition adverse valide, l'étape 2 n'a pas lieu d'être.
    if (!opponent) {
      await this.router.navigate(['/list', list.id, 'adversary'], { replaceUrl: true });
      return;
    }
    this.playerDisposition.set(player);
    this.opponentDisposition.set(opponent);

    this.boards.set(await this.referential.boardsForPair(list.forceDispositionId, opponent.id));

    const shapes = await this.referential.allBaseShapes();
    this.shapes.set(new Map(shapes.map((shape) => [shape.id, shape])));
  }

  /** Suivi du plateau visible pendant le défilement horizontal du pager. */
  onPagerScroll(): void {
    const host = this.pager?.nativeElement;
    if (!host || host.clientWidth === 0) return;
    const index = Math.round(host.scrollLeft / host.clientWidth);
    if (index !== this.activeIndex()) this.activeIndex.set(index);
  }

  /** Onglets numérotés du pager (« 1 2 3 » de la maquette). */
  goTo(index: number): void {
    const host = this.pager?.nativeElement;
    this.activeIndex.set(index);
    host?.scrollTo({ left: index * host.clientWidth, behavior: 'smooth' });
  }

  /**
   * RG_14: tap sur l'aperçu — plateau seul en plein écran, avec les repères de
   * mesure, quel que soit le statut (y compris rouge). Cette vue ne montre
   * jamais les placements du joueur.
   */
  openBoardOnly(slide: BoardSlide): void {
    this.viewer.set({ variant: 'with-measurements', board: slide.board });
  }

  /**
   * RG_14: « Consulter » — plateau sans repères de mesure, avec les placements
   * superposés en lecture seule. Réservé au statut vert.
   */
  openDeploymentView(): void {
    const slide = this.activeSlide();
    if (!slide || !this.canConsult()) return;
    this.viewer.set({ variant: 'no-measurements', board: slide.board });
  }

  closeViewer(): void {
    this.viewer.set(null);
  }

  /**
   * RG_14: « Nouveau » — toujours disponible. Écrase le déploiement existant
   * du triplet après confirmation explicite (même principe que RG_08), en
   * conservant son identifiant : c'est une mise à jour en place (RG_07), pas
   * une nouvelle entrée.
   */
  async startNew(): Promise<void> {
    const slide = this.activeSlide();
    const list = this.list();
    if (!slide || !list) return;

    if (slide.status === 'missing') {
      await this.openPlacement(slide, true);
      return;
    }

    const alert = await this.alerts.create({
      header: 'Écraser ce déploiement ?',
      message:
        `Un déploiement existe déjà pour ce plateau ` +
        `(${slide.deployment?.placements.length ?? 0} placement(s), ` +
        // RG_25: la réserve fait partie de ce que « Nouveau » remet à zéro.
        `${slide.deployment?.reservedUnitIds?.length ?? 0} unité(s) en réserve). ` +
        `Le repartir de zéro effacera définitivement ces placements et cette réserve.`,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Repartir de zéro',
          role: 'destructive',
          handler: () => {
            void this.openPlacement(slide, true);
          },
        },
      ],
    });
    await alert.present();
  }

  /** RG_14: « Éditer » — ouvre l'écran de placement préchargé. */
  async edit(): Promise<void> {
    const slide = this.activeSlide();
    if (!slide || !this.canEdit()) return;
    await this.openPlacement(slide, false);
  }

  private async openPlacement(slide: BoardSlide, reset: boolean): Promise<void> {
    const list = this.list();
    if (!list) return;

    // EX_04/RG_07: le déploiement est créé (ou remis à zéro) dès l'ouverture,
    // pour que la saisie soit sauvegardée en continu et non en fin de parcours.
    await this.library.openDeployment({
      listId: list.id,
      opponentDispositionId: this.opponentId(),
      boardId: slide.board.id,
      defaultName: this.library.defaultDeploymentName(list.name, this.boardLabel(slide.board)),
      reset,
    });

    await this.router.navigate([
      '/list',
      list.id,
      'adversary',
      this.opponentId(),
      'board',
      slide.board.id,
      'placement',
    ]);
  }

  /** RG_24: libellé complet exposé par le nom accessible d'une pastille du pager. */
  slideStatusLabel(slide: BoardSlide): string {
    return STATUS_LABELS[slide.status];
  }

  /**
   * RG_14: le bandeau de titre imprimé dans l'image par la source (RT_12) est
   * masqué du cadrage de l'aperçu — il identifiait le plateau une seconde
   * fois, et dans l'ordre inverse du bandeau des deux dispositions, rendant
   * impossible de savoir laquelle des deux est la sienne.
   *
   * Seul le HAUT est rogné, jusqu'à `playArea.top` : le pied de légende de
   * l'image (symboles d'objectifs, zones de déploiement) est un contenu
   * porteur d'information au sens de RT_31 et reste affiché. C'est le
   * rognage complet au rectangle de jeu de RT_19 qui est propre à l'écran de
   * placement, où l'espace vertical est disputé.
   */
  previewCrop(board: Board): Record<string, string> {
    return { 'aspect-ratio': `${board.width} / ${board.height - board.playArea.top}` };
  }

  previewImage(board: Board): Record<string, string> {
    const visibleHeight = board.height - board.playArea.top;
    return {
      width: '100%',
      height: `${(board.height / visibleHeight) * 100}%`,
      left: '0',
      top: `${(-board.playArea.top / visibleHeight) * 100}%`,
    };
  }

  boardLabel(board: Board): string {
    const player = this.playerDisposition()?.label ?? '';
    const opponent = this.opponentDisposition()?.label ?? '';
    return board.mirror
      ? `${player} miroir · ${board.index}`
      : `${player} vs ${opponent} · ${board.index}`;
  }

  back(): Promise<boolean> {
    return this.router.navigate(['/list', this.listId(), 'adversary']);
  }
}
