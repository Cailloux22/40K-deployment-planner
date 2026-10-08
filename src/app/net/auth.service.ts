import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { LocalStoreService } from '../data/local-store.service';
import { AuthResult, AuthSession, AuthUser, Credentials } from '../models/sync.models';
import { SYNC_API_BASE_URL, readApiFailure, syncUrl } from './api';
import { ConnectivityService } from './connectivity.service';
import { DeviceService } from './device.service';

const SESSION_KEY = 'auth.session';

/** RT_21: erreur d'authentification porteuse d'un message affichable. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** RG_50: bornes du mot de passe (8 à 128 caractères, sans autre contrainte). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * RT_21 / RT_67 — compte et connexion de l'appareil contre le serveur de
 * synchronisation (RT_09, cf. `specification/openapi.yml` v1.1.0).
 *
 * RG_10: le compte est optionnel. L'application reste pleinement fonctionnelle
 * sans session, sur les seules données locales.
 * RT_67/RG_53: la connexion renvoie un jeton d'appareil permanent, sans
 * expiration ni renouvellement, persisté dans la configuration légère (RT_08)
 * pour que la synchronisation redémarre sans ressaisie. Il ne prend fin qu'à
 * la déconnexion depuis cet appareil ou à la suppression du compte.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(LocalStoreService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly device = inject(DeviceService);

  private readonly session = signal<AuthSession | null>(this.readSession());

  readonly user = computed<AuthUser | null>(() => this.session()?.user ?? null);
  readonly signedIn = computed(() => this.session() !== null);

  /** RT_71: aucun serveur n'est configuré pour ce build (`syncApiBaseUrl` à `null`). */
  readonly available = SYNC_API_BASE_URL !== null;

  /** RT_21/RT_14: les actions de compte ne sont proposées qu'en ligne. */
  readonly canAuthenticate = computed(() => this.available && this.connectivity.online());

  /**
   * Une session enregistrée par un client du contrat v0.1 (couple
   * access/refresh token) n'a pas de jeton d'appareil : elle est ignorée et
   * l'appareil repart en usage local (RG_10), le joueur se reconnecte.
   */
  private readSession(): AuthSession | null {
    if (!SYNC_API_BASE_URL) return null;
    const stored = this.store.getConfig<Partial<AuthSession>>(SESSION_KEY);
    return stored?.deviceToken && stored.user ? (stored as AuthSession) : null;
  }

  deviceToken(): string | null {
    return this.session()?.deviceToken ?? null;
  }

  private persist(session: AuthSession | null): void {
    this.session.set(session);
    this.store.setConfig(SESSION_KEY, session);
  }

  private requireOnline(action: string): void {
    if (!this.available) throw new AuthError(`${action} n'est pas disponible dans cette version.`);
    if (!this.connectivity.online()) {
      throw new AuthError(this.connectivity.offlineMessage(action));
    }
  }

  /** RG_18/RG_50: « Créer un compte ». */
  async register(credentials: Credentials): Promise<AuthUser> {
    this.requireOnline('La création de compte');
    return this.authenticate('/auth/register', credentials, 'Création de compte impossible');
  }

  /** RG_18/RG_50: « Se connecter ». */
  async login(credentials: Credentials): Promise<AuthUser> {
    this.requireOnline('La connexion');
    return this.authenticate('/auth/login', credentials, 'Connexion impossible');
  }

  private async authenticate(path: string, credentials: Credentials, failureLabel: string): Promise<AuthUser> {
    try {
      // RT_67: l'appareil se présente (identifiant stable, libellé, plateforme)
      // pour que ses écritures lui soient attribuées dans les conflits (RG_54).
      const result = await firstValueFrom(
        this.http.post<AuthResult>(syncUrl(path), { ...credentials, device: this.device.describe() }),
      );
      this.persist({ deviceToken: result.deviceToken, user: result.user });
      return result.user;
    } catch (err) {
      // RG_50: le message du serveur est le même pour une adresse inconnue et
      // un mot de passe erroné, et donne le délai d'attente après des échecs
      // répétés (RT_69).
      throw new AuthError(`${failureLabel} : ${readApiFailure(err).message}`);
    }
  }

  /**
   * RG_19/RG_53: la déconnexion ramène à un usage local seul et ne supprime
   * aucune donnée stockée localement (RT_08), qui reste utilisable (RG_10).
   * Elle est effective même si l'appel au serveur échoue.
   */
  async logout(): Promise<void> {
    const token = this.deviceToken();
    this.persist(null);
    if (!token || !this.available || !this.connectivity.online()) return;
    try {
      // Le jeton n'est plus dans la session : il est joint explicitement.
      await firstValueFrom(
        this.http.post(syncUrl('/auth/logout'), {}, {
          headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
        }),
      );
    } catch {
      // RG_09: l'invalidation côté serveur est un bonus — son échec ne doit
      // pas empêcher la déconnexion locale, déjà effective.
    }
  }

  /**
   * RT_67/RG_53: jeton refusé (`401 UNAUTHENTICATED`) — l'appareil a été
   * déconnecté ou le compte supprimé depuis un autre appareil. Retour à
   * l'usage local, sans erreur bloquante ni perte de données (RG_09, RG_10).
   */
  dropSession(): void {
    if (this.session()) this.persist(null);
  }

  // -------------------------------------------------------------------------
  // RG_52 — gestion du compte, mot de passe courant exigé
  // -------------------------------------------------------------------------

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.requireOnline('Le changement de mot de passe');
    try {
      await firstValueFrom(this.http.put(syncUrl('/account/password'), { currentPassword, newPassword }));
    } catch (err) {
      throw new AuthError(`Changement impossible : ${readApiFailure(err).message}`);
    }
  }

  async changeEmail(newEmail: string, password: string): Promise<AuthUser> {
    this.requireOnline("Le changement d'adresse");
    try {
      const user = await firstValueFrom(this.http.put<AuthUser>(syncUrl('/account/email'), { newEmail, password }));
      const current = this.session();
      if (current) this.persist({ ...current, user });
      return user;
    } catch (err) {
      throw new AuthError(`Changement impossible : ${readApiFailure(err).message}`);
    }
  }

  /**
   * RG_52: suppression immédiate et totale du compte sur le serveur. Les
   * données de l'appareil sont conservées et l'appareil repasse aussitôt en
   * usage local (RG_10).
   */
  async deleteAccount(password: string): Promise<void> {
    this.requireOnline('La suppression du compte');
    try {
      await firstValueFrom(this.http.post(syncUrl('/account/delete'), { password }));
    } catch (err) {
      throw new AuthError(`Suppression impossible : ${readApiFailure(err).message}`);
    }
    this.persist(null);
  }
}
