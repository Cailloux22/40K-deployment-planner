import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { LocalStoreService } from '../data/local-store.service';
import { AuthSession, AuthTokens, AuthUser, Credentials } from '../models/sync.models';
import { ConnectivityService } from './connectivity.service';

const SESSION_KEY = 'auth.session';

/** RT_21: erreur d'authentification porteuse d'un message affichable. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * RT_21 — authentification (sign up / sign in) contre le même backend que la
 * synchronisation (RT_09, cf. `specification/openapi.yml`).
 *
 * RG_10: le compte est optionnel. L'application reste pleinement fonctionnelle
 * sans session, sur les seules données locales.
 * RT_21: la session obtenue est persistée avec les autres données de
 * configuration légères (RT_08) pour que la synchronisation redémarre sans
 * ressaisie ; la détection de connectivité de RT_14 désactive ces actions
 * hors-ligne.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(LocalStoreService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly session = signal<AuthSession | null>(this.store.getConfig<AuthSession>(SESSION_KEY));

  readonly user = computed<AuthUser | null>(() => this.session()?.user ?? null);
  readonly signedIn = computed(() => this.session() !== null);

  /** RT_21/RT_14: les actions de compte ne sont proposées qu'en ligne. */
  readonly canAuthenticate = computed(() => this.connectivity.online());

  accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  private url(path: string): string {
    return `${environment.syncApiBaseUrl}${path}`;
  }

  private persist(session: AuthSession | null): void {
    this.session.set(session);
    this.store.setConfig(SESSION_KEY, session);
  }

  private requireOnline(action: string): void {
    if (!this.connectivity.online()) {
      throw new AuthError(this.connectivity.offlineMessage(action));
    }
  }

  /** RG_18: « Créer un compte ». */
  async register(credentials: Credentials): Promise<AuthUser> {
    this.requireOnline('La création de compte');
    return this.authenticate('/auth/register', credentials, 'Création de compte impossible');
  }

  /** RG_18: « Se connecter ». */
  async login(credentials: Credentials): Promise<AuthUser> {
    this.requireOnline('La connexion');
    return this.authenticate('/auth/login', credentials, 'Connexion impossible');
  }

  private async authenticate(
    path: string,
    credentials: Credentials,
    failureLabel: string,
  ): Promise<AuthUser> {
    try {
      const session = await firstValueFrom(
        this.http.post<AuthSession>(this.url(path), credentials),
      );
      this.persist(session);
      return session.user;
    } catch (err) {
      throw new AuthError(`${failureLabel} : ${describeHttpError(err)}`);
    }
  }

  /**
   * RG_19: la déconnexion ramène à un usage local seul et ne supprime aucune
   * donnée stockée localement (RT_08), qui reste utilisable (RG_10).
   */
  async logout(): Promise<void> {
    const token = this.accessToken();
    this.persist(null);
    if (!token || !this.connectivity.online()) return;
    try {
      await firstValueFrom(this.http.post(this.url('/auth/logout'), {}));
    } catch {
      // RG_09: l'invalidation côté serveur est un bonus — son échec ne doit
      // pas empêcher la déconnexion locale, déjà effective.
    }
  }

  /**
   * Renouvelle l'access token. Utilisé par la synchronisation quand le
   * serveur répond 401 ; un échec renvoie l'application en usage local sans
   * interrompre le travail en cours (RG_09).
   */
  async refresh(): Promise<boolean> {
    const current = this.session();
    if (!current || !this.connectivity.online()) return false;
    try {
      const tokens = await firstValueFrom(
        this.http.post<AuthTokens>(this.url('/auth/refresh'), {
          refreshToken: current.refreshToken,
        }),
      );
      this.persist({ ...current, ...tokens });
      return true;
    } catch {
      this.persist(null);
      return false;
    }
  }
}

/** Message d'erreur réseau lisible par le joueur. */
export function describeHttpError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const serverMessage = (err.error as { message?: string } | null)?.message;
    if (serverMessage) return serverMessage;
    if (err.status === 0) return 'serveur injoignable';
    if (err.status === 401) return 'identifiants invalides';
    if (err.status === 409) return 'un compte existe déjà pour cet email';
    return `erreur ${err.status}`;
  }
  return err instanceof Error ? err.message : 'erreur inconnue';
}
