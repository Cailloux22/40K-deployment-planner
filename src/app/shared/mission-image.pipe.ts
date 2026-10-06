import { Pipe, PipeTransform, inject } from '@angular/core';

import { MissionCard } from '../models/referential.models';
import { MissionImageService } from '../referentials/mission-image.service';

/**
 * RT_65: image d'une carte de mission, à combiner avec `async` —
 * `[src]="card | missionImage | async"`. Jamais `card.asset` directement.
 */
@Pipe({ name: 'missionImage', standalone: false })
export class MissionImagePipe implements PipeTransform {
  private readonly images = inject(MissionImageService);

  transform(card: MissionCard | null | undefined): Promise<string> | null {
    return card ? this.images.imageUrl(card) : null;
  }
}
