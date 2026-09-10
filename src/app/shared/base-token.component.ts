import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

import { BaseShape } from '../models/referential.models';
import { contrastingTextColor } from '../import/unit-colors';

/**
 * EX_03 / RG_06 / RT_05 — token de socle autonome.
 *
 * Utilisé par le bandeau de sélection de modèles (RT_17: « chaque élément de
 * la liste est rendu comme un token draggable identique en forme et en
 * couleur au token qui sera posé sur le plateau ») et par le récapitulatif
 * d'import / le menu unités pour figurer une forme de socle.
 *
 * La forme respecte le socle réel : cercle pour un socle rond, ellipse pour un
 * ovale, avec son grand axe vertical avant rotation.
 */
@Component({
  selector: 'app-base-token',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="token"
      [attr.width]="box()"
      [attr.height]="box()"
      [attr.viewBox]="'0 0 ' + box() + ' ' + box()"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <g [attr.transform]="'translate(' + box() / 2 + ',' + box() / 2 + ') rotate(' + rotation + ')'">
        <ellipse
          [attr.rx]="rx()"
          [attr.ry]="ry()"
          [attr.fill]="color"
          [attr.fill-opacity]="placed ? 0.35 : 1"
          [attr.stroke]="placed ? color : 'rgba(0, 0, 0, 0.55)'"
          [attr.stroke-width]="placed ? 2 : 1"
          [attr.stroke-dasharray]="placed ? '3 3' : null"
        />
        @if (label) {
          <text
            class="label"
            text-anchor="middle"
            dominant-baseline="central"
            [attr.fill]="placed ? 'rgba(0, 0, 0, 0.55)' : textColor()"
            [attr.transform]="'rotate(' + -rotation + ')'"
          >
            {{ label }}
          </text>
        }
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .token {
        display: block;
        overflow: visible;
      }
      .label {
        font-size: 10px;
        font-weight: 600;
        pointer-events: none;
      }
    `,
  ],
})
export class BaseTokenComponent {
  private readonly currentShape = signal<BaseShape | undefined>(undefined);

  /** Socle représenté ; l'absence de socle rend le token vide (RG_02). */
  @Input({ required: true })
  set shape(value: BaseShape | undefined) {
    this.currentShape.set(value);
  }
  get shape(): BaseShape | undefined {
    return this.currentShape();
  }

  /** RG_06: couleur de l'unité, partagée par tous ses tokens. */
  @Input() color = '#888888';
  /** RG_20: rotation en degrés, appliquée au rendu comme au placement. */
  @Input() rotation = 0;
  /** RG_15: un modèle déjà placé reste visible mais visuellement distingué. */
  @Input() placed = false;
  @Input() label?: string;

  /**
   * RT_05: pixels par millimètre. Dans le bandeau, l'échelle est choisie pour
   * la lisibilité au doigt ; sur le plateau, elle vient de `assetPixelsPerMm`.
   */
  @Input() pixelsPerMm = 0.9;

  readonly rx = computed(() => ((this.currentShape()?.widthMm ?? 25) * this.pixelsPerMm) / 2);
  readonly ry = computed(() => ((this.currentShape()?.lengthMm ?? 25) * this.pixelsPerMm) / 2);

  /** Le viewBox est carré pour que la rotation ne rogne jamais le token. */
  readonly box = computed(() => 2 * Math.max(this.rx(), this.ry()) + 4);

  readonly textColor = computed(() => contrastingTextColor(this.color));

  readonly ariaLabel = computed(() => {
    const shape = this.currentShape();
    const base = shape ? shape.label : 'socle non assigné';
    return this.placed ? `${base} — déjà placé` : base;
  });
}
