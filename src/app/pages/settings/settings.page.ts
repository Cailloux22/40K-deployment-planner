import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { APP_VERSION } from '../../app-version';
import { ReferentialSource } from '../../models/referential.models';
import { AuthError, AuthService } from '../../net/auth.service';
import { ConnectivityService } from '../../net/connectivity.service';
import { SyncService } from '../../net/sync.service';
import { ReferentialService } from '../../referentials/referential.service';
import { BoardPrefetchService } from '../../pwa/board-prefetch.service';
import { InstallService } from '../../pwa/install.service';
import { StoragePersistenceService } from '../../pwa/storage-persistence.service';

type AuthMode = 'signIn' | 'signUp';

/**
 * Écran 9 — Réglages (= À propos / crédits).
 *
 * RG_18: écran unique accessible depuis l'accueil par l'icône engrenage,
 * regroupant les blocs Compte, Informations utilisateur, Mentions des sources
 * tierces et, hors application empaquetée, Application (RG_41, RG_42, RG_44).
 * Il n'existe pas d'écran « À propos » séparé.
 *
 * RT_20: la liste des mentions n'est pas codée en dur ici : elle est
 * construite en énumérant les référentiels embarqués et en lisant
 * l'attribution que chacun transporte.
 * RG_18/RT_21: seules les actions réseau (création de compte, connexion,
 * synchronisation) sont soumises à la dégradation gracieuse de RG_09 ; les
 * mentions et les informations de compte déjà connues restent consultables
 * hors-ligne.
 */
@Component({
  selector: 'app-settings',
  templateUrl: 'settings.page.html',
  styleUrls: ['settings.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly referential = inject(ReferentialService);
  private readonly router = inject(Router);
  private readonly install = inject(InstallService);
  private readonly prefetch = inject(BoardPrefetchService);
  private readonly persistence = inject(StoragePersistenceService);

  /** RG_18: le bloc « Application » n'existe que hors application empaquetée. */
  readonly webApp = this.install.webApp;
  readonly installed = this.install.installed;
  readonly canInvite = this.install.canInvite;
  readonly prefetchStatus = this.prefetch.status;
  readonly persisted = this.persistence.persisted;

  /** RG_42/RG_49: « Prêt pour le hors-ligne » ou « Téléchargement des plateaux et missions : n / 115 ». */
  readonly offlineLabel = computed(() => {
    const progress = `Téléchargement des plateaux et missions : ${this.prefetch.present()} / ${this.prefetch.total()}`;
    switch (this.prefetch.status()) {
      case 'ready':
        return 'Prêt pour le hors-ligne';
      case 'paused':
        return `${progress} (en pause)`;
      case 'unsupported':
        return 'Non disponible dans ce navigateur';
      default:
        return progress;
    }
  });

  /** RG_47: bloc « Version », affiché dans tous les contextes, y compris hors-ligne. */
  readonly appVersion = APP_VERSION;

  readonly online = this.connectivity.online;
  readonly signedIn = this.auth.signedIn;
  readonly user = this.auth.user;
  /** RT_21/RT_14: sign up / sign in désactivés hors-ligne. */
  readonly canAuthenticate = this.auth.canAuthenticate;
  readonly hasConflicts = computed(() => this.sync.pendingConflicts().length > 0);

  /** RT_20: attributions lues dans les référentiels embarqués. */
  readonly attributions = signal<readonly ReferentialSource[]>([]);

  readonly mode = signal<AuthMode>('signIn');
  readonly email = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly canSubmit = computed(
    () =>
      this.canAuthenticate() &&
      !this.busy() &&
      this.email().includes('@') &&
      this.password().length >= 8,
  );

  async ngOnInit(): Promise<void> {
    this.attributions.set(await this.referential.attributions());
  }

  /** RG_19: état de synchronisation courant (synchronisé / en attente / hors-ligne). */
  syncStateLabel(): string {
    return this.sync.stateLabel();
  }

  syncStateColor(): string {
    switch (this.sync.state()) {
      case 'synced':
        return 'success';
      case 'conflict':
      case 'error':
        return 'danger';
      case 'offline':
      case 'pending':
        return 'warning';
      default:
        return 'medium';
    }
  }

  lastSyncedAt(): string | null {
    const iso = this.sync.lastSyncedAt();
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('fr-FR');
  }

  setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  /** RG_18/RT_21: « Créer un compte » / « Se connecter ». */
  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(null);
    const credentials = { email: this.email().trim(), password: this.password() };
    try {
      if (this.mode() === 'signUp') await this.auth.register(credentials);
      else await this.auth.login(credentials);
      this.password.set('');
    } catch (err) {
      this.error.set(
        err instanceof AuthError ? err.message : `Action impossible : ${(err as Error).message}`,
      );
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * RG_19/RG_10: la déconnexion ramène à un usage local seul et ne supprime
   * aucune donnée stockée localement.
   */
  async logout(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.logout();
    } finally {
      this.busy.set(false);
    }
  }

  /** RT_10: relance manuelle, jamais bloquante pour l'interface. */
  syncNow(): void {
    void this.sync.synchronize();
  }

  /** RG_42: action manuelle en mode économie de données. */
  downloadBoards(): void {
    void this.prefetch.downloadNow();
  }

  /** RG_44 / RT_58: « Protéger mes données », hors installation. */
  protectData(): void {
    void this.persistence.request();
  }

  back(): Promise<boolean> {
    return this.router.navigate(['/home']);
  }
}
