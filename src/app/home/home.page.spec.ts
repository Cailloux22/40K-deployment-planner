import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular/lazy';

import { LibraryService } from '../data/library.service';
import { ArmyList } from '../models/domain.models';
import { ConnectivityService } from '../net/connectivity.service';
import { SyncService } from '../net/sync.service';
import { ReferentialService } from '../referentials/referential.service';
import { HomePage } from './home.page';

const DISPOSITIONS = [
  {
    id: 'priority-assets',
    slug: 'priority-assets',
    label: 'Priority Assets',
    importNames: ['Priority Assets'],
    icon: { viewBox: '0 0 24 24', mode: 'fill' as const, paths: ['M0 0h1v1H0z'] },
  },
];

function armyList(id: string, name: string): ArmyList {
  return {
    id,
    name,
    forceDispositionId: 'priority-assets',
    units: [
      {
        id: `${id}_u0`,
        name: 'Skitarii Rangers',
        modelCount: 10,
        modelGroups: [{ id: `${id}_u0_g0`, name: 'Skitarii Rangers', count: 10, baseShapeId: 'round-25' }],
        color: '#e6194b',
      },
    ],
    importedAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    versionToken: null,
    dirty: true,
  };
}

describe('HomePage — écran 1 (accueil / bibliothèque)', () => {
  let fixture: ComponentFixture<HomePage>;
  let component: HomePage;
  let online: ReturnType<typeof signal<boolean>>;
  let navigate: ReturnType<typeof vi.fn>;
  let alertCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    online = signal(true);
    navigate = vi.fn().mockResolvedValue(true);
    alertCreate = vi.fn().mockResolvedValue({ present: vi.fn().mockResolvedValue(undefined) });

    const library = {
      lists: signal<readonly ArmyList[]>([armyList('list_1', 'Breachers protector')]),
      deployments: signal([]),
      loaded: signal(true),
      load: vi.fn().mockResolvedValue(undefined),
      deploymentsOfList: () => [],
      deleteList: vi.fn().mockResolvedValue(undefined),
      duplicateList: vi.fn().mockResolvedValue(undefined),
      saveList: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      declarations: [HomePage],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: LibraryService, useValue: library },
        { provide: ReferentialService, useValue: { allDispositions: async () => DISPOSITIONS } },
        { provide: ConnectivityService, useValue: { online, offlineMessage: () => 'hors-ligne' } },
        { provide: SyncService, useValue: { pendingConflicts: signal([]) } },
        { provide: Router, useValue: { navigate } },
        { provide: AlertController, useValue: { create: alertCreate } },
        { provide: ToastController, useValue: { create: alertCreate } },
        { provide: ActionSheetController, useValue: { create: alertCreate } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    await component.ngOnInit();
    fixture.detectChanges();
  });

  it('résume chaque liste importée (unités, modèles, déploiements)', () => {
    const [card] = component.cards();
    expect(card.list.name).toBe('Breachers protector');
    expect(card.unitCount).toBe(1);
    expect(card.modelCount).toBe(10);
    expect(card.deploymentCount).toBe(0);
    expect(card.disposition?.label).toBe('Priority Assets');
  });

  it('RG_03 : ouvrir une liste mène à l’étape 1 (disposition adverse)', async () => {
    await component.openList(component.cards()[0].list);
    expect(navigate).toHaveBeenCalledWith(['/list', 'list_1', 'adversary']);
  });

  it('RG_18 : les Réglages sont accessibles depuis l’accueil', async () => {
    await component.openSettings();
    expect(navigate).toHaveBeenCalledWith(['/settings']);
  });

  it('RG_13/RT_14 : en ligne, l’import est accessible', async () => {
    await component.openImport();
    expect(navigate).toHaveBeenCalledWith(['/import']);
  });

  it('RG_13/RT_14 : hors-ligne, l’import est bloqué avec un message explicite', async () => {
    online.set(false);
    await component.openImport();
    // Aucune navigation vers l'import, et un message présenté au joueur.
    expect(navigate).not.toHaveBeenCalledWith(['/import']);
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Import indisponible hors-ligne' }),
    );
  });
});
