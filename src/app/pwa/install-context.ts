import { Capacitor } from '@capacitor/core';

/**
 * RT_55 — mode d'invitation à l'installation (RG_41).
 *
 * - `none` : application empaquetée, ou navigateur qui ne permet pas
 *   l'installation — aucune invitation ;
 * - `installed` : lancée depuis l'écran d'accueil ;
 * - `ios-instructions` : iPhone / iPad, ajout manuel par « Partager » ;
 * - `prompt` : le navigateur propose sa propre installation.
 */
export type InstallMode = 'none' | 'installed' | 'ios-instructions' | 'prompt';

export interface InstallEnvironment {
  readonly native: boolean;
  readonly standalone: boolean;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** Un évènement `beforeinstallprompt` a été capturé. */
  readonly promptAvailable: boolean;
}

/** RT_55: iPhone, iPad ou iPod — iPadOS se déclare « Macintosh » mais est tactile. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** RT_55: ordre d'évaluation de la règle, du plus au moins prioritaire. */
export function installMode(env: InstallEnvironment): InstallMode {
  if (env.native) return 'none';
  if (env.standalone) return 'installed';
  if (isAppleMobile(env.userAgent, env.maxTouchPoints)) return 'ios-instructions';
  if (env.promptAvailable) return 'prompt';
  return 'none';
}

/** Application Android empaquetée (Capacitor) : la PWA est sans objet (RT_54). */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** RT_55: lancée depuis l'écran d'accueil (manifeste `display: standalone`). */
export function isStandalone(): boolean {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  return (
    globalThis.matchMedia?.('(display-mode: standalone)').matches === true ||
    nav?.standalone === true
  );
}

export function readInstallEnvironment(promptAvailable: boolean): InstallEnvironment {
  const nav = globalThis.navigator;
  return {
    native: isNativeApp(),
    standalone: isStandalone(),
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    promptAvailable,
  };
}

/** RT_54/RT_56: une page contrôlée par le service worker de l'application. */
export function serviceWorkerControlled(): boolean {
  return !!globalThis.navigator?.serviceWorker?.controller;
}
