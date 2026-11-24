import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LibraryService } from '../data/library.service';
import { LocalStoreService } from '../data/local-store.service';
import { ArmyList } from '../models/domain.models';
import { ReferentialService } from '../referentials/referential.service';
import { TOUR_PROPOSED_KEY, TourService } from './tour.service';

/** RG_62/RT_83: proposition de la visite à la première ouverture sur l'appareil. */
describe('TourService.proposeOnFirstLaunch — RG_62/RT_83', () => {
  let config: Map<string, unknown>;
  let lists: ReturnType<typeof signal<readonly ArmyList[]>>;
  let service: TourService;
  let start: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = new Map();
    lists = signal<readonly ArmyList[]>([]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: LocalStoreService,
          useValue: {
            getConfig: (key: string) => config.get(key) ?? null,
            setConfig: (key: string, value: unknown) => config.set(key, value),
          },
        },
        { provide: LibraryService, useValue: { lists, load: vi.fn().mockResolvedValue(undefined) } },
        { provide: ReferentialService, useValue: {} },
      ],
    });
    service = TestBed.inject(TourService);
    start = vi.fn().mockResolvedValue(undefined);
    service.start = start as unknown as TourService['start'];
  });

  it('démarre la visite sur un appareil neuf à la bibliothèque vide', async () => {
    await service.proposeOnFirstLaunch();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('ne fait que marquer la visite comme proposée si la bibliothèque a déjà des listes', async () => {
    lists.set([{ id: 'list_1' } as ArmyList]);
    await service.proposeOnFirstLaunch();
    expect(start).not.toHaveBeenCalled();
    expect(config.get(TOUR_PROPOSED_KEY)).toBe(true);
  });

  it('ne la propose plus une fois proposée, quelle que soit la bibliothèque', async () => {
    config.set(TOUR_PROPOSED_KEY, true);
    await service.proposeOnFirstLaunch();
    expect(start).not.toHaveBeenCalled();
  });

  it('confie et retire les actions d’un écran', () => {
    const hooks = { openConsult: vi.fn(), closeConsult: vi.fn() };
    const unregister = service.register('boards', hooks);
    unregister();
    // Un retrait tardif d'un écran remplacé ne retire pas celles de son successeur.
    const next = { openConsult: vi.fn(), closeConsult: vi.fn() };
    const unregisterNext = service.register('boards', next);
    unregister();
    expect((service as unknown as { hooks: Record<string, unknown> }).hooks['boards']).toBe(next);
    unregisterNext();
  });
});
