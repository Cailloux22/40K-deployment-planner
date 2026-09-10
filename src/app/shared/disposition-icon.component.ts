import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { ForceDisposition } from '../models/referential.models';

/**
 * RT_23 — rendu de l'icône d'une disposition de force.
 *
 * L'icône vient du référentiel embarqué (pas d'un jeu d'icônes codé en dur
 * dans les écrans) : elle est donc identique au récapitulatif d'import
 * (RG_22), au choix de la disposition adverse (RG_03 étape 1) et dans
 * l'en-tête du choix de plateau (RG_03 étape 2).
 */
@Component({
  selector: 'app-disposition-icon',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (disposition) {
      <svg
        class="icon"
        [attr.viewBox]="disposition.icon.viewBox"
        [attr.width]="size"
        [attr.height]="size"
        [attr.aria-label]="disposition.label"
        role="img"
      >
        @for (path of disposition.icon.paths; track path) {
          <path
            [attr.d]="path"
            [attr.fill]="disposition.icon.mode === 'fill' ? 'currentColor' : 'none'"
            [attr.stroke]="disposition.icon.mode === 'stroke' ? 'currentColor' : 'none'"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
      </svg>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .icon {
        display: block;
      }
    `,
  ],
})
export class DispositionIconComponent {
  @Input() disposition?: ForceDisposition;
  @Input() size = 28;
}
