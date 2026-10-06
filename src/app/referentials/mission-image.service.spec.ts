import { TestBed } from '@angular/core/testing';

import { STORE_MISSION_IMAGES } from '../data/local-store.service';
import { MissionCard } from '../models/referential.models';
import { MissionImageService } from './mission-image.service';
import { RemoteImageRequest, RemoteImageService } from './remote-image.service';

const front = 'assets/referentials/missions/reconnaissance/triangulation.png';
const back = 'assets/referentials/missions/reconnaissance/triangulation-back.png';

const card: MissionCard = {
  id: 'reconnaissance/triangulation',
  name: 'Triangulation',
  disposition: 'reconnaissance',
  opponent: 'purge-the-foe',
  width: 1653,
  height: 2833,
  asset: front,
  remoteAsset: 'https://gdmissions.app/assets/11th/primary-missions/reconnaissance/triangulation.png',
  back: {
    asset: back,
    remoteAsset: 'https://gdmissions.app/assets/11th/primary-missions/reconnaissance/triangulation-back.png',
  },
};

describe('MissionImageService (RT_65)', () => {
  let requests: RemoteImageRequest[];
  let service: MissionImageService;

  beforeEach(() => {
    requests = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RemoteImageService,
          useValue: {
            imageUrl: async (request: RemoteImageRequest) => {
              requests.push(request);
              return request.asset;
            },
          },
        },
      ],
    });
    service = TestBed.inject(MissionImageService);
  });

  it('résout le recto par défaut, sous l\'identifiant de la carte', async () => {
    await expect(service.imageUrl(card)).resolves.toBe(front);
    expect(requests[0]).toMatchObject({
      store: STORE_MISSION_IMAGES,
      id: 'reconnaissance/triangulation',
      remoteUrl: card.remoteAsset,
      width: 1653,
      height: 2833,
    });
  });

  it('résout le verso comme une image à part, sous la clé {id}#back, aux dimensions du recto', async () => {
    await expect(service.imageUrl(card, 'back')).resolves.toBe(back);
    expect(requests[0]).toMatchObject({
      id: 'reconnaissance/triangulation#back',
      remoteUrl: card.back?.remoteAsset,
      width: 1653,
      height: 2833,
    });
  });

  it('rend le recto pour un verso demandé sur une carte qui n\'en a pas', async () => {
    const { back: _ignored, ...withoutBack } = card;
    await expect(service.imageUrl(withoutBack, 'back')).resolves.toBe(front);
    expect(requests[0].id).toBe('reconnaissance/triangulation');
  });
});
