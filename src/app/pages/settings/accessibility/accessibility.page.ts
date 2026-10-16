import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AccessibilityService } from '../../../data/accessibility.service';

/**
 * RG_57 — sous-menu « Accessibilité » des Réglages : une option par ligne,
 * libellé, phrase d'explication et interrupteur. Un changement s'applique
 * aussitôt, sans bouton « Enregistrer » (RT_77).
 */
@Component({
  selector: 'app-accessibility',
  templateUrl: 'accessibility.page.html',
  styleUrls: ['accessibility.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessibilityPage {
  private readonly accessibility = inject(AccessibilityService);
  private readonly router = inject(Router);

  /** RG_58: désactivation du contrôle de cohésion d'unité. */
  readonly coherencyCheckDisabled = this.accessibility.coherencyCheckDisabled;

  setCoherencyCheckDisabled(disabled: boolean): void {
    this.accessibility.set('coherencyCheckDisabled', disabled);
  }

  /** RG_57: retour vers les Réglages. */
  back(): Promise<boolean> {
    return this.router.navigate(['/settings']);
  }
}
