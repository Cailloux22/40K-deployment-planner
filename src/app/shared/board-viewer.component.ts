import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';

import { normalizeGameplanNote } from '../deployment/gameplan-note';
import { DeploymentShareInfo } from '../deployment/share-image';
import { BoardImageService, isUnavailableBoardImage } from '../referentials/board-image.service';
import { DeploymentShareService } from './deployment-share.service';
import { GameplanNoteService } from './gameplan-note.service';
import { MissionsService } from './missions.service';

import { ArmyList, Placement } from '../models/domain.models';
import { BaseShape, BaseShapeKind, Board, BoardVariant } from '../models/referential.models';
import { resolveGroupShape, tokenSize } from '../deployment/token-geometry';
import { UNIT_COLOR_FALLBACK } from '../import/unit-colors';

interface PlacementView {
  readonly placement: Placement;
  readonly color: string;
  readonly rx: number;
  readonly ry: number;
  /** RT_26: rectangle rendu comme tel plutôt qu'inscrit dans une ellipse. */
  readonly shapeKind: BaseShapeKind;
}

/**
 * RT_16 — visualiseur plein écran zoomable de plateau.
 *
 * Composant unique partagé par les deux vues plein écran de RG_14 :
 * - « plateau seul », variante `with-measurements`, sans aucun placement ;
 * - « Consulter », variante `no-measurements`, avec les placements existants
 *   superposés en lecture seule.
 *
 * Le pan/zoom (RT_16) est celui de `app-pan-zoom`, partagé avec la fenêtre
 * des missions primaires (RT_66) ; le pincement pilote le zoom, un doigt
 * déplace l'image. Un bouton de fermeture est affiché en permanence en haut à
 * gauche.
 *
 * Ce composant est distinct de l'éditeur de placement (RT_03), qui reste dédié
 * à la saisie par drag-and-drop et n'expose aucun geste de zoom (RG_17).
 */
@Component({
  selector: 'app-board-viewer',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="viewer" role="dialog" aria-modal="true" [attr.aria-label]="title">
      <!-- RT_16: croix de fermeture, toujours affichée en haut à gauche. -->
      <ion-button
        class="close"
        fill="solid"
        color="dark"
        shape="round"
        aria-label="Fermer la vue plein écran"
        (click)="closed.emit()"
      >
        <ion-icon name="close" slot="icon-only"></ion-icon>
      </ion-button>

      <div class="corner-actions">
        <!-- RG_56/RT_75: partage du déploiement en image JPG, à gauche des
             missions ; seule la vue « Consulter » reçoit shareInfo. Deux
             boutons à libellé fixe plutôt qu'un aria-label lié (RT_43). -->
        @if (shareInfo) {
          @switch (shareState()) {
            @case ('ready') {
              <ion-button
                class="corner"
                fill="solid"
                color="dark"
                shape="round"
                aria-label="Partager le déploiement en image"
                (click)="share()"
              >
                <ion-icon name="share-social-outline" slot="icon-only"></ion-icon>
              </ion-button>
            }
            @case ('busy') {
              <!-- RG_56: inactif, avec indicateur d'attente, pendant la production. -->
              <ion-button
                class="corner"
                fill="solid"
                color="dark"
                shape="round"
                disabled="true"
                aria-label="Préparation de l'image en cours"
              >
                <ion-spinner name="crescent" slot="icon-only"></ion-spinner>
              </ion-button>
            }
            @default {
              <!-- RG_56: plateau non disponible hors-ligne (RG_42) — visible mais inactif. -->
              <ion-button
                class="corner"
                fill="solid"
                color="dark"
                shape="round"
                disabled="true"
                aria-label="Partage indisponible : plateau non chargé"
              >
                <ion-icon name="share-social-outline" slot="icon-only"></ion-icon>
              </ion-button>
            }
          }
        }

        <!-- RG_48/RT_66: missions primaires du couple, à gauche du plan de jeu ;
             seule la vue « Consulter » reçoit le couple. -->
        @if (missionPair) {
          <ion-button
            class="corner"
            fill="solid"
            color="dark"
            shape="round"
            aria-label="Voir les missions primaires"
            (click)="openMissions()"
          >
            <ion-icon name="document-text-outline" slot="icon-only"></ion-icon>
          </ion-button>
        }

        <!-- RG_46/RT_62: note de plan de jeu en lecture seule, en haut à droite,
             hors de la surface zoomée ; absente quand il n'y a pas de note. -->
        @if (hasNote()) {
          <ion-button
            class="corner"
            fill="solid"
            color="dark"
            shape="round"
            aria-label="Lire le plan de jeu"
            (click)="openNote()"
          >
            <ion-icon name="clipboard" slot="icon-only"></ion-icon>
          </ion-button>
        }
      </div>

      @if (title) {
        <div class="title">{{ title }}</div>
      }

      @if (board) {
        <app-pan-zoom class="surface" [contentWidth]="board.width" [contentHeight]="board.height">
          <img
            class="board"
            [src]="board | boardImage: variant | async"
            [alt]="title || 'Plateau'"
            [style.width.px]="board.width"
            [style.height.px]="board.height"
            draggable="false"
          />

          <!-- RT_16: placements superposés en lecture seule (aucun geste
               de déplacement n'est branché ici). -->
          @if (placementViews().length) {
            <svg
              #overlay
              class="overlay"
              [attr.viewBox]="'0 0 ' + board.width + ' ' + board.height"
              [attr.width]="board.width"
              [attr.height]="board.height"
              aria-hidden="true"
            >
              @for (view of placementViews(); track view.placement.idModele) {
                <!-- RT_26: un gabarit rectangulaire se rend comme tel. -->
                @if (view.shapeKind === 'rectangle') {
                  <rect
                    [attr.x]="view.placement.x - view.rx"
                    [attr.y]="view.placement.y - view.ry"
                    [attr.width]="view.rx * 2"
                    [attr.height]="view.ry * 2"
                    [attr.fill]="view.color"
                    fill-opacity="0.85"
                    stroke="var(--app-token-stroke)"
                    stroke-width="2"
                    [attr.transform]="
                      'rotate(' +
                      view.placement.rotation +
                      ' ' +
                      view.placement.x +
                      ' ' +
                      view.placement.y +
                      ')'
                    "
                  />
                } @else {
                  <ellipse
                    [attr.cx]="view.placement.x"
                    [attr.cy]="view.placement.y"
                    [attr.rx]="view.rx"
                    [attr.ry]="view.ry"
                    [attr.fill]="view.color"
                    fill-opacity="0.85"
                    stroke="var(--app-token-stroke)"
                    stroke-width="2"
                    [attr.transform]="
                      'rotate(' +
                      view.placement.rotation +
                      ' ' +
                      view.placement.x +
                      ' ' +
                      view.placement.y +
                      ')'
                    "
                  />
                }
              }
            </svg>
          }
        </app-pan-zoom>
      }

      <div class="hint">Pincez pour zoomer · glissez pour déplacer</div>

      <!-- RT_75: pendant la composition, les gestes du visualiseur ne
           reçoivent aucun évènement. -->
      @if (sharing()) {
        <div class="busy-shield"></div>
      }
    </div>
  `,
  styles: [
    `
      .viewer {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: var(--app-surface-stage);
        display: flex;
        overflow: hidden;
      }
      .surface {
        /* RT_16: la surface garde la taille de l'écran. */
        flex: 1;
      }
      .board {
        display: block;
        max-width: none;
        user-select: none;
        -webkit-user-drag: none;
      }
      .overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .close {
        position: absolute;
        top: max(12px, env(safe-area-inset-top));
        left: 12px;
        z-index: 2;
        margin: 0;
      }
      .corner-actions {
        position: absolute;
        top: max(12px, env(safe-area-inset-top));
        right: 12px;
        z-index: 2;
        display: flex;
        gap: var(--app-touch-gap);
      }
      .corner {
        margin: 0;
      }
      .title {
        position: absolute;
        top: max(20px, calc(env(safe-area-inset-top) + 8px));
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
        color: var(--app-text-on-stage);
        font-size: var(--app-font-sm);
        font-weight: 600;
        text-align: center;
        pointer-events: none;
      }
      .busy-shield {
        position: absolute;
        inset: 0;
        z-index: 1;
      }
      .hint {
        position: absolute;
        bottom: max(12px, env(safe-area-inset-bottom));
        left: 0;
        right: 0;
        text-align: center;
        color: var(--app-text-on-stage);
        opacity: 0.75;
        font-size: var(--app-font-xs);
        pointer-events: none;
      }
    `,
  ],
})
export class BoardViewerComponent implements OnChanges {
  @Input() board?: Board;
  /** RT_16: `with-measurements` pour le plateau seul, `no-measurements` sinon. */
  @Input() variant: BoardVariant = 'with-measurements';
  @Input() title?: string;

  /** RG_14: placements affichés uniquement par la vue « Consulter ». */
  @Input() placements: readonly Placement[] = [];
  @Input() list?: ArmyList;
  @Input() shapes: ReadonlyMap<string, BaseShape> = new Map();

  /**
   * RG_46/RT_62: note de plan de jeu du déploiement consulté. Le visualiseur
   * « plateau seul » n'en reçoit jamais.
   */
  @Input() set note(value: string | null | undefined) {
    this.noteText.set(normalizeGameplanNote(value));
  }

  /**
   * RG_48/RT_66: couple de dispositions du déploiement consulté. Le
   * visualiseur « plateau seul » n'en reçoit jamais : l'écran de choix du
   * plateau porte déjà le bouton.
   */
  @Input() missionPair?: { readonly playerDispositionId: string; readonly opponentDispositionId: string };

  /**
   * RG_56/RT_75: identification du déploiement partagé. Seule la vue
   * « Consulter » (déploiement terminé) la reçoit ; sans elle, pas de bouton.
   */
  @Input() shareInfo?: DeploymentShareInfo;

  @Output() readonly closed = new EventEmitter<void>();

  @ViewChild('overlay') private overlay?: ElementRef<SVGSVGElement>;

  private readonly missions = inject(MissionsService);
  private readonly boardImages = inject(BoardImageService);
  private readonly sharer = inject(DeploymentShareService);
  private readonly toasts = inject(ToastController);

  /** RT_74: URL de l'image du plateau affiché — `undefined` tant qu'elle n'est pas résolue. */
  private readonly boardUrl = signal<string | undefined>(undefined);
  readonly sharing = signal(false);

  /** RG_56: prêt, en cours de production, ou plateau indisponible (RG_42). */
  readonly shareState = computed<'ready' | 'busy' | 'unavailable'>(() => {
    const url = this.boardUrl();
    if (this.sharing() || url === undefined) return 'busy';
    return isUnavailableBoardImage(url) ? 'unavailable' : 'ready';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['board'] && !changes['variant'] && !changes['shareInfo']) return;
    const board = this.board;
    this.boardUrl.set(undefined);
    if (!board || !this.shareInfo) return;
    // RT_74: même chaîne que le pipe `boardImage` (RT_27) — même URL, déjà
    // résolue pour l'affichage, sans second appel réseau dans la session.
    const variant = this.variant;
    void this.boardImages.imageUrl(board, variant).then((url) => {
      if (this.board === board && this.variant === variant) this.boardUrl.set(url);
    });
  }

  /**
   * RG_56: compose l'image JPG et ouvre l'envoi. Le déploiement n'est pas
   * modifié, ni le zoom et le cadrage du visualiseur.
   */
  async share(): Promise<void> {
    const board = this.board;
    const info = this.shareInfo;
    const url = this.boardUrl();
    if (!board || !info || !url || this.shareState() !== 'ready') return;

    this.sharing.set(true);
    try {
      const outcome = await this.sharer.share(board, url, this.overlay?.nativeElement ?? null, info);
      // RT_75: repli par téléchargement — un message bref l'indique.
      if (outcome === 'downloaded') await this.toast('Image enregistrée dans les téléchargements');
    } catch {
      // RG_09/RT_75: message bref, non bloquant, sans détail technique.
      await this.toast('Le partage a échoué');
    } finally {
      this.sharing.set(false);
    }
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2500, position: 'bottom' });
    await toast.present();
  }

  private readonly notes = inject(GameplanNoteService);
  private readonly noteText = signal('');
  readonly hasNote = computed(() => this.noteText() !== '');

  /** RG_46: ouvre la note en lecture seule ; zoom et cadrage restent intacts. */
  openNote(): void {
    void this.notes.view(this.noteText());
  }

  /** RG_48: le zoom et le cadrage du visualiseur restent intacts. */
  openMissions(): void {
    const pair = this.missionPair;
    if (!pair) return;
    void this.missions.open({ ...pair, board: this.board, boardLabel: this.title });
  }

  /**
   * Placements rendus en lecture seule. Les coordonnées sont celles du repère
   * de l'asset (RT_04), la taille du token vient du socle réel (RT_05) et la
   * couleur de l'unité (RG_06).
   */
  readonly placementViews = computed<readonly PlacementView[]>(() => {
    const list = this.list;
    const board = this.board;
    if (!list || !board || this.placements.length === 0) return [];

    const pixelsPerMm = this.assetPixelsPerMm(board);
    // RT_28: le socle effectif d'un groupe, rectangle sur mesure inclus.
    const groupShape = new Map<string, BaseShape | undefined>();
    const unitColor = new Map<string, string>();
    for (const unit of list.units) {
      unitColor.set(unit.id, unit.color);
      for (const group of unit.modelGroups) groupShape.set(group.id, resolveGroupShape(group, this.shapes));
    }

    const views: PlacementView[] = [];
    for (const placement of this.placements) {
      const groupId = placement.idModele.split('#')[0];
      const shape = groupShape.get(groupId);
      if (!shape) continue;
      const size = tokenSize(shape, pixelsPerMm);
      views.push({
        placement,
        // RT_32: repli unique, partagé avec l’éditeur de placement.
        color: unitColor.get(placement.idUnite) ?? UNIT_COLOR_FALLBACK,
        rx: size.width / 2,
        ry: size.height / 2,
        shapeKind: shape.shape,
      });
    }
    return views;
  });

  /**
   * RT_05: échelle du plateau. Recalculée localement à partir du rectangle
   * mesuré, pour ne pas dépendre d'un chargement asynchrone du référentiel
   * dans un composant purement visuel.
   */
  private assetPixelsPerMm(board: Board): number {
    const MM_PER_INCH = 25.4;
    const horizontal = board.playArea.width / (44 * MM_PER_INCH);
    const vertical = board.playArea.height / (60 * MM_PER_INCH);
    return (horizontal + vertical) / 2;
  }
}
