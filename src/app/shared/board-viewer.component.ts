import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';

import { ArmyList, Placement } from '../models/domain.models';
import { BaseShape, BaseShapeKind, Board, BoardVariant } from '../models/referential.models';
import { resolveGroupShape, tokenSize } from '../deployment/token-geometry';

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
 * Décision technique (RT_16, autrefois ouverte) : le pan/zoom est implémenté
 * ici, sur les évènements Pointer et une transformation CSS, sans librairie
 * tierce. Le geste de pincement pilote le zoom, un doigt déplace l'image ; un
 * bouton de fermeture est affiché en permanence en haut à gauche.
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

      @if (title) {
        <div class="title">{{ title }}</div>
      }

      <div
        #surface
        class="surface"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (wheel)="onWheel($event)"
      >
        <div class="stage" [style.transform]="transform()">
          @if (board) {
            <img
              class="board"
              [src]="assetSrc()"
              [alt]="title || 'Plateau'"
              draggable="false"
              (load)="onImageLoad()"
            />

            <!-- RT_16: placements superposés en lecture seule (aucun geste
                 de déplacement n'est branché ici). -->
            @if (placementViews().length) {
              <svg
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
                      stroke="rgba(0, 0, 0, 0.6)"
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
                      stroke="rgba(0, 0, 0, 0.6)"
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
          }
        </div>
      </div>

      <div class="hint">Pincez pour zoomer · glissez pour déplacer</div>
    </div>
  `,
  styles: [
    `
      .viewer {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: #11131a;
        display: flex;
        overflow: hidden;
      }
      .surface {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        /* Le composant gère lui-même pincement et déplacement : on neutralise
           les gestes natifs du navigateur sur cette zone. */
        touch-action: none;
        overscroll-behavior: contain;
        cursor: grab;
      }
      .stage {
        position: relative;
        transform-origin: 0 0;
        will-change: transform;
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
      .title {
        position: absolute;
        top: max(20px, calc(env(safe-area-inset-top) + 8px));
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
        color: #f4f4f5;
        font-size: 0.85rem;
        font-weight: 600;
        text-align: center;
        pointer-events: none;
      }
      .hint {
        position: absolute;
        bottom: max(12px, env(safe-area-inset-bottom));
        left: 0;
        right: 0;
        text-align: center;
        color: rgba(244, 244, 245, 0.6);
        font-size: 0.75rem;
        pointer-events: none;
      }
    `,
  ],
})
export class BoardViewerComponent {
  @ViewChild('surface') surface?: ElementRef<HTMLElement>;

  @Input() board?: Board;
  /** RT_16: `with-measurements` pour le plateau seul, `no-measurements` sinon. */
  @Input() variant: BoardVariant = 'with-measurements';
  @Input() title?: string;

  /** RG_14: placements affichés uniquement par la vue « Consulter ». */
  @Input() placements: readonly Placement[] = [];
  @Input() list?: ArmyList;
  @Input() shapes: ReadonlyMap<string, BaseShape> = new Map();

  @Output() readonly closed = new EventEmitter<void>();

  private readonly scale = signal(1);
  private readonly offset = signal({ x: 0, y: 0 });
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; scale: number } | null = null;
  private panStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
  private fitted = false;

  readonly transform = computed(() => {
    const { x, y } = this.offset();
    return `translate(${x}px, ${y}px) scale(${this.scale()})`;
  });

  assetSrc(): string {
    return this.board ? this.board.assets[this.variant] : '';
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
        color: unitColor.get(placement.idUnite) ?? '#888888',
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

  /** Ajuste l'image à l'écran à la première ouverture. */
  fitToScreen(): void {
    const host = this.surface?.nativeElement;
    const board = this.board;
    if (!host || !board) return;
    const scale = Math.min(host.clientWidth / board.width, host.clientHeight / board.height);
    this.scale.set(scale);
    this.offset.set({
      x: (host.clientWidth - board.width * scale) / 2,
      y: (host.clientHeight - board.height * scale) / 2,
    });
    this.fitted = true;
  }

  onImageLoad(): void {
    if (!this.fitted) this.fitToScreen();
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.fitted) this.fitToScreen();
    try {
      // Confort de saisie seulement : un échec de capture ne doit pas
      // empêcher le pan/zoom, géré par les écouteurs de la surface.
      (event.target as Element).setPointerCapture?.(event.pointerId);
    } catch {
      /* pointeur non capturable */
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      const offset = this.offset();
      this.panStart = {
        x: event.clientX,
        y: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    } else if (this.pointers.size === 2) {
      this.panStart = null;
      this.pinchStart = { distance: this.pointerDistance(), scale: this.scale() };
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Deux doigts : pincement, centré sur le milieu du geste pour que le point
    // regardé reste sous les doigts.
    if (this.pointers.size >= 2 && this.pinchStart) {
      const distance = this.pointerDistance();
      if (distance > 0) {
        const target = this.clampScale((this.pinchStart.scale * distance) / this.pinchStart.distance);
        this.zoomAround(this.pointerMidpoint(), target);
      }
      return;
    }

    if (this.panStart) {
      this.offset.set({
        x: this.panStart.offsetX + (event.clientX - this.panStart.x),
        y: this.panStart.offsetY + (event.clientY - this.panStart.y),
      });
    }
  }

  onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) {
      this.panStart = null;
      return;
    }
    // Un doigt reste posé après un pincement : il reprend le déplacement.
    const [remaining] = [...this.pointers.values()];
    const offset = this.offset();
    this.panStart = {
      x: remaining.x,
      y: remaining.y,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  }

  /** Molette / pavé tactile : équivalent desktop du pincement. */
  onWheel(event: WheelEvent): void {
    if (!this.fitted) this.fitToScreen();
    event.preventDefault();
    const factor = Math.exp(-event.deltaY / 400);
    this.zoomAround({ x: event.clientX, y: event.clientY }, this.clampScale(this.scale() * factor));
  }

  private clampScale(value: number): number {
    return Math.min(Math.max(value, 0.1), 8);
  }

  /** Zoom conservant le point `center` (coordonnées écran) sous les doigts. */
  private zoomAround(center: { x: number; y: number }, nextScale: number): void {
    const host = this.surface?.nativeElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const localX = center.x - rect.left;
    const localY = center.y - rect.top;
    const current = this.scale();
    const offset = this.offset();
    const ratio = nextScale / current;
    this.offset.set({
      x: localX - (localX - offset.x) * ratio,
      y: localY - (localY - offset.y) * ratio,
    });
    this.scale.set(nextScale);
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pointerMidpoint(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
