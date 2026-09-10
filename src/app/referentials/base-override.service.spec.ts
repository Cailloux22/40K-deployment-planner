import { TestBed } from '@angular/core/testing';

import { LocalStoreService, STORE_BASE_OVERRIDES } from '../data/local-store.service';
import { BaseOverride, BaseOverrideService } from './base-override.service';

/**
 * RT_25 — le store IndexedDB lui-même (RT_08) n'est pas exercé ici : seul le
 * contrat entre BaseOverrideService et LocalStoreService compte.
 */
class FakeLocalStore {
  readonly records = new Map<string, BaseOverride>();

  async get<T>(store: string, id: string): Promise<T | undefined> {
    expect(store).toBe(STORE_BASE_OVERRIDES);
    return this.records.get(id) as T | undefined;
  }

  async put<T>(store: string, value: T): Promise<void> {
    expect(store).toBe(STORE_BASE_OVERRIDES);
    const override = value as BaseOverride;
    this.records.set(override.key, override);
  }
}

describe('BaseOverrideService — RT_25', () => {
  let service: BaseOverrideService;
  let store: FakeLocalStore;

  beforeEach(() => {
    store = new FakeLocalStore();
    TestBed.configureTestingModule({
      providers: [{ provide: LocalStoreService, useValue: store }],
    });
    service = TestBed.inject(BaseOverrideService);
  });

  it('ne trouve rien tant qu’aucune assignation n’a été mémorisée', async () => {
    await expect(service.get('datasheet::line')).resolves.toBeUndefined();
  });

  it('mémorise puis retrouve le socle assigné à une ligne de référentiel', async () => {
    const key = BaseOverrideService.key('baneblade', 'baneblade');
    await service.remember(key, 'oval-170x105');
    await expect(service.get(key)).resolves.toBe('oval-170x105');
  });

  it('la clé combine les clés de datasheet et de ligne de modèle', () => {
    expect(BaseOverrideService.key('baneblade', 'baneblade')).toBe('baneblade::baneblade');
  });

  it('une réassignation remplace la précédente pour la même clé', async () => {
    const key = BaseOverrideService.key('rhino', 'rhino');
    await service.remember(key, 'oval-90x52');
    await service.remember(key, 'oval-120x92');
    await expect(service.get(key)).resolves.toBe('oval-120x92');
  });
});
