import { Pipe, PipeTransform, inject } from '@angular/core';

import { Board, BoardVariant } from '../models/referential.models';
import { BoardImageService } from '../referentials/board-image.service';

/**
 * RT_12 / RT_27: image d'un plateau pour la variante demandée, à combiner avec
 * `async` — `[src]="board | boardImage: 'no-measurements' | async"`.
 */
@Pipe({ name: 'boardImage', standalone: false })
export class BoardImagePipe implements PipeTransform {
  private readonly images = inject(BoardImageService);

  transform(board: Board | null | undefined, variant: BoardVariant): Promise<string> | null {
    return board ? this.images.imageUrl(board, variant) : null;
  }
}
