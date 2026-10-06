import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';

/** Déplacement horizontal minimal, en px, pour qu'un geste compte comme un balayage. */
const SWIPE_MIN_PX = 60;

/**
 * RT_16 — surface de pan/zoom partagée.
 *
 * Décision technique (RT_16, autrefois ouverte) : le pan/zoom est implémenté
 * ici, sur les évènements Pointer et une transformation CSS (`translate` +
 * `scale`), sans librairie tierce. Un doigt déplace, deux doigts pincent —
 * centré sur le milieu du geste —, la molette tient lieu de pincement sur
 * poste de travail.
 *
 * RT_66: extrait du visualiseur plein écran pour être réutilisé par la
 * fenêtre des missions primaires, plutôt que réécrit. Le contenu (image,
 * calque SVG) est projeté dans la scène ; ses dimensions natives sont
 * données en entrée, et l'ajustement initial est *contain* sur la surface.
 */
@Component({
  selector: 'app-pan-zoom',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="surface"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (wheel)="onWheel($event)"
    >
      <div class="stage" [style.transform]="transform()">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        /* Sans min-width/min-height à 0, un item flex ou grille s'élargit à
           la taille native du contenu et l'ajustement le centre alors hors
           de la surface. */
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      .surface {
        position: absolute;
        inset: 0;
        overflow: hidden;
        /* Le composant gère lui-même pincement et déplacement : on neutralise
           les gestes natifs du navigateur sur cette zone. */
        touch-action: none;
        overscroll-behavior: contain;
        cursor: grab;
      }
      .stage {
        /* Le placement est entièrement porté par la transformation (offset +
           échelle) : la scène part du coin haut-gauche de la surface. */
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        will-change: transform;
      }
    `,
  ],
})
export class PanZoomComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Dimensions natives du contenu projeté, en px. */
  @Input() contentWidth = 0;
  @Input() contentHeight = 0;

  /**
   * RT_66: au zoom d'ouverture, un glisser horizontal ne déplace pas le
   * contenu mais émet `swipe` (changement d'onglet) ; une fois agrandi, il
   * redevient un déplacement, pour ne pas entrer en conflit avec lui.
   */
  @Input() swipeAtFit = false;

  /** -1 : vers la gauche (élément suivant), +1 : vers la droite (précédent). */
  @Output() readonly swipe = new EventEmitter<-1 | 1>();

  private readonly scale = signal(1);
  private readonly fitScale = signal(1);
  private readonly offset = signal({ x: 0, y: 0 });
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; scale: number } | null = null;
  private panStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
  private swipeStart: { x: number; y: number } | null = null;
  private fitted = false;
  private resizeObserver?: ResizeObserver;

  readonly transform = computed(() => {
    const { x, y } = this.offset();
    return `translate(${x}px, ${y}px) scale(${this.scale()})`;
  });

  /** RT_66: vrai tant que le contenu est à son zoom d'ouverture. */
  readonly atFit = computed(() => this.scale() <= this.fitScale() * 1.001);

  ngAfterViewInit(): void {
    // RG_48: la surface change de taille avec la présentation (onglets ou
    // côte à côte) et la rotation de l'appareil ; un contenu resté au zoom
    // d'ouverture est réajusté, un contenu agrandi est laissé tel quel.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.fitted || this.atFit()) this.fit();
      });
      this.resizeObserver.observe(this.host.nativeElement);
    }
    this.fit();
  }

  ngOnChanges(): void {
    if (this.fitted) this.fit();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  /** Ajuste le contenu à la surface (*contain*), centré. */
  fit(): void {
    const el = this.host.nativeElement;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!width || !height || !this.contentWidth || !this.contentHeight) return;
    const scale = Math.min(width / this.contentWidth, height / this.contentHeight);
    this.fitScale.set(scale);
    this.scale.set(scale);
    this.offset.set({
      x: (width - this.contentWidth * scale) / 2,
      y: (height - this.contentHeight * scale) / 2,
    });
    this.fitted = true;
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.fitted) this.fit();
    try {
      // Confort de saisie seulement : un échec de capture ne doit pas
      // empêcher le pan/zoom, géré par les écouteurs de la surface.
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    } catch {
      /* pointeur non capturable */
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      const offset = this.offset();
      this.panStart = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
      this.swipeStart = this.swipeAtFit && this.atFit() ? { x: event.clientX, y: event.clientY } : null;
    } else if (this.pointers.size === 2) {
      this.panStart = null;
      this.swipeStart = null;
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

    // RT_66: au zoom d'ouverture, le geste est un balayage, pas un déplacement.
    if (this.swipeStart) return;

    if (this.panStart) {
      this.offset.set({
        x: this.panStart.offsetX + (event.clientX - this.panStart.x),
        y: this.panStart.offsetY + (event.clientY - this.panStart.y),
      });
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.swipeStart && this.pointers.size === 1) {
      const dx = event.clientX - this.swipeStart.x;
      const dy = event.clientY - this.swipeStart.y;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.swipe.emit(dx < 0 ? -1 : 1);
      }
    }
    this.swipeStart = null;

    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) {
      this.panStart = null;
      return;
    }
    // Un doigt reste posé après un pincement : il reprend le déplacement.
    const [remaining] = [...this.pointers.values()];
    const offset = this.offset();
    this.panStart = { x: remaining.x, y: remaining.y, offsetX: offset.x, offsetY: offset.y };
  }

  /** Molette / pavé tactile : équivalent desktop du pincement. */
  onWheel(event: WheelEvent): void {
    if (!this.fitted) this.fit();
    event.preventDefault();
    const factor = Math.exp(-event.deltaY / 400);
    this.zoomAround({ x: event.clientX, y: event.clientY }, this.clampScale(this.scale() * factor));
  }

  private clampScale(value: number): number {
    return Math.min(Math.max(value, 0.1), 8);
  }

  /** Zoom conservant le point `center` (coordonnées écran) sous les doigts. */
  private zoomAround(center: { x: number; y: number }, nextScale: number): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
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
