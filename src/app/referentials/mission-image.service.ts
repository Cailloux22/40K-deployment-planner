import { Injectable, inject } from '@angular/core';

import { STORE_MISSION_IMAGES } from '../data/local-store.service';
import { MissionCard, MissionFace } from '../models/referential.models';
import { RemoteImageService, unavailableImage } from './remote-image.service';

/**
 * RT_65 / RG_49 — résolution de l'image affichée pour une carte de mission :
 * même chaîne réseau → cache → embarquée que les plateaux (RT_27), dans un
 * store dédié `missionImages` indexé par l'identifiant de la carte.
 */
@Injectable({ providedIn: 'root' })
export class MissionImageService {
  private readonly images = inject(RemoteImageService);

  /**
   * URL affichable (URL d'objet ou chemin d'asset) ; ne rejette jamais.
   * RT_65: une face `back` demandée sur une carte sans verso rend le recto.
   */
  imageUrl(card: MissionCard, face: MissionFace = 'front'): Promise<string> {
    // RT_65: le verso est une image à part entière de la chaîne, sous sa
    // propre clé de cache `{id}#back`, aux dimensions du recto (RT_64).
    const back = face === 'back' ? card.back : undefined;
    return this.images.imageUrl({
      store: STORE_MISSION_IMAGES,
      id: back ? `${card.id}#back` : card.id,
      remoteUrl: back ? back.remoteAsset : card.remoteAsset,
      // RT_65: dimensions mesurées à l'ingestion (RT_64).
      width: card.width,
      height: card.height,
      asset: back ? back.asset : card.asset,
      unavailable: () => unavailableMissionImage(card),
    });
  }
}

/** RG_49: « Mission non disponible hors-ligne », jamais une image cassée. */
export function unavailableMissionImage(card: MissionCard): string {
  return unavailableImage(
    card,
    { x: card.width / 2, y: card.height / 2, fontSize: Math.round(card.width / 14) },
    ['Mission non disponible', 'hors-ligne'],
  );
}
