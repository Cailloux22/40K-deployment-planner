import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * RT_21: le jeton de session persisté localement est joint aux appels du
 * backend de synchronisation, pour que RT_10 démarre sans ressaisie.
 *
 * Seules les URL du backend sont concernées : les référentiels statiques
 * (RT_02, RT_12, RT_23) sont des assets locaux et ne doivent jamais porter
 * d'en-tête d'autorisation.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.syncApiBaseUrl)) return next(req);

  const token = inject(AuthService).accessToken();
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
