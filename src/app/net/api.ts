import { HttpErrorResponse } from '@angular/common/http';

import { environment } from '../../environments/environment';
import { ApiErrorBody, ApiErrorCode } from '../models/sync.models';

/** RT_71: la synchronisation n'existe que si l'environnement de build donne une adresse. */
export const SYNC_API_BASE_URL: string | null = environment.syncApiBaseUrl;

export function syncUrl(path: string): string {
  if (!SYNC_API_BASE_URL) throw new Error('Aucun serveur de synchronisation configuré');
  return `${SYNC_API_BASE_URL}${path}`;
}

/** RT_69: lecture du corps d'erreur commun ; le client décide sur `code`, jamais sur `message`. */
export interface ApiFailure {
  readonly status: number;
  readonly code: ApiErrorCode | null;
  readonly message: string;
  /** `Retry-After` d'une réponse 429, en secondes. */
  readonly retryAfter: number | null;
}

export function readApiFailure(err: unknown): ApiFailure {
  if (err instanceof HttpErrorResponse) {
    const body = (err.error ?? null) as Partial<ApiErrorBody> | null;
    const retry = Number(err.headers?.get('Retry-After'));
    return {
      status: err.status,
      code: (body && typeof body === 'object' && body.code) || null,
      message: describeHttpError(err),
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    };
  }
  return { status: -1, code: null, message: describeHttpError(err), retryAfter: null };
}

/** Message d'erreur lisible par le joueur — celui du serveur quand il en donne un (RT_69). */
export function describeHttpError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const serverMessage = (err.error as { message?: string } | null)?.message;
    if (serverMessage) return serverMessage;
    if (err.status === 0) return 'serveur injoignable';
    return `erreur ${err.status}`;
  }
  return err instanceof Error ? err.message : 'erreur inconnue';
}
