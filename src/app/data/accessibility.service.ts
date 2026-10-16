import { Injectable, computed, inject, signal } from '@angular/core';

import { LocalStoreService } from './local-store.service';

/** RT_77: options d'accessibilité réglables par le joueur (RG_57). */
export interface AccessibilityOptions {
  /** RG_58: le contrôle de cohésion d'unité (RG_26) n'est plus appliqué. */
  readonly coherencyCheckDisabled: boolean;
}

/** RT_77: clé de configuration légère (RT_08) des options. */
export const ACCESSIBILITY_KEY = 'accessibility';

/** RT_77: toutes les options désactivées — le comportement spécifié ailleurs. */
export const DEFAULT_ACCESSIBILITY_OPTIONS: AccessibilityOptions = { coherencyCheckDisabled: false };

/**
 * RT_77: relecture tolérante. Une valeur absente ou illisible vaut les
 * valeurs par défaut ; une option inconnue est ignorée, une option manquante
 * ou mal typée prend sa valeur par défaut — pour qu'une version plus récente
 * ou plus ancienne de l'application relise le même objet sans erreur.
 */
export function readAccessibilityOptions(raw: unknown): AccessibilityOptions {
  const stored = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    coherencyCheckDisabled:
      typeof stored['coherencyCheckDisabled'] === 'boolean'
        ? stored['coherencyCheckDisabled']
        : DEFAULT_ACCESSIBILITY_OPTIONS.coherencyCheckDisabled,
  };
}

/**
 * RT_77 — options d'accessibilité (RG_57).
 *
 * Propres à l'appareil : rangées dans la configuration légère de RT_08, jamais
 * dans les stores des listes et déploiements (RT_06), ni synchronisées (RT_09),
 * ni effacées par la déconnexion (RT_21).
 */
@Injectable({ providedIn: 'root' })
export class AccessibilityService {
  private readonly store = inject(LocalStoreService);

  private readonly state = signal<AccessibilityOptions>(
    readAccessibilityOptions(this.store.getConfig<unknown>(ACCESSIBILITY_KEY)),
  );

  readonly options = this.state.asReadonly();

  /** RG_58: le contrôle de cohésion d'unité est-il désactivé ? */
  readonly coherencyCheckDisabled = computed(() => this.state().coherencyCheckDisabled);

  /**
   * RG_57: un changement s'applique aussitôt — le signal est mis à jour avant
   * l'écriture —, puis est conservé. Un échec d'écriture est absorbé par
   * `setConfig` (RG_09) : l'option vaut pour la session en cours.
   */
  set<K extends keyof AccessibilityOptions>(option: K, value: AccessibilityOptions[K]): void {
    const next = { ...this.state(), [option]: value };
    this.state.set(next);
    this.store.setConfig(ACCESSIBILITY_KEY, next);
  }
}
