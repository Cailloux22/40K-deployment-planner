import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { APP_VERSION } from '../app-version';
import { SYNC_API_BASE_URL } from './api';
import { AuthService } from './auth.service';

/**
 * RT_21/RT_67: le jeton d'appareil persisté localement est joint aux appels
 * du serveur de synchronisation, pour que RT_10 démarre sans ressaisie.
 * RT_69: chaque appel porte la version de l'application (`X-Client-Version`).
 *
 * Seules les URL du serveur sont concernées : les référentiels statiques
 * (RT_02, RT_12, RT_23) et les images distantes ne doivent jamais porter
 * d'en-tête d'autorisation.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!SYNC_API_BASE_URL || !req.url.startsWith(SYNC_API_BASE_URL)) return next(req);

  const auth = inject(AuthService);
  const token = req.headers.has('Authorization') ? null : auth.deviceToken();
  const setHeaders: Record<string, string> = { 'X-Client-Version': APP_VERSION };
  if (token) setHeaders['Authorization'] = `Bearer ${token}`;

  return next(req.clone({ setHeaders })).pipe(
    catchError((err: unknown) => {
      // RT_67/RG_53: un jeton inconnu (appareil déconnecté, compte supprimé
      // ailleurs) ramène à l'usage local. Un 401 `INVALID_CREDENTIALS` — mot
      // de passe courant erroné sur une action de RG_52 — ne déconnecte pas.
      if (
        token &&
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        (err.error as { code?: string } | null)?.code === 'UNAUTHENTICATED'
      ) {
        auth.dropSession();
      }
      return throwError(() => err);
    }),
  );
};
