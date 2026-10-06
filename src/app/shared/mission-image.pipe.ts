import { Pipe, PipeTransform, inject } from '@angular/core';

import { MissionCard, MissionFace } from '../models/referential.models';
import { MissionImageService } from '../referentials/mission-image.service';

/**
 * RT_65: image d'une carte de mission pour la face demandée, à combiner avec
 * `async` — `[src]="card | missionImage: face | async"`. Jamais `card.asset`
 * ni `card.back.asset` directement.
 */
@Pipe({ name: 'missionImage', standalone: false })
export class MissionImagePipe implements PipeTransform {
  private readonly images = inject(MissionImageService);

  transform(card: MissionCard | null | undefined, face: MissionFace = 'front'): Promise<string> | null {
    return card ? this.images.imageUrl(card, face) : null;
  }
}
