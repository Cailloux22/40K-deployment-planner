import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';

import { LibraryService } from '../../data/library.service';
import { ImportDraft, ListImportService } from '../../import/list-import.service';
import { ArmyUnit } from '../../models/domain.models';
import { ConnectivityService } from '../../net/connectivity.service';
import { BaseOverrideService } from '../../referentials/base-override.service';
import { ReferentialService } from '../../referentials/referential.service';
import { ImportPage } from './import.page';

/**
 * RT_25 — seule la mémorisation d'une assignation manuelle est couverte ici ;
 * le reste de l'écran (RG_01/RG_13/RG_22) n'a pas de suite de tests dédiée.
 */
function unit(): ArmyUnit {
  return {
    id: 'u1',
    name: 'Skorpius Disintegrator',
    modelCount: 1,
    modelGroups: [
      {
        id: 'u1_g0',
        name: 'Skorpius Disintegrator',
        count: 1,
        baseShapeId: null,
        unresolvedReason: 'Socle non publié pour « Skorpius Disintegrator » (« Use model »)',
        overrideKey: 'skorpius disintegrator::skorpius disintegrator',
      },
    ],
    color: '#e6194b',
  };
}

describe('ImportPage.assignShape — RT_25', () => {
  let fixture: ComponentFixture<ImportPage>;
  let component: ImportPage;
  let remember: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    remember = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      declarations: [ImportPage],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ListImportService, useValue: { acceptAttribute: () => '.json' } },
        { provide: ReferentialService, useValue: { allBaseShapes: async () => [] } },
        { provide: BaseOverrideService, useValue: { remember } },
        { provide: LibraryService, useValue: {} },
        { provide: ConnectivityService, useValue: { online: signal(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AlertController, useValue: { create: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportPage);
    component = fixture.componentInstance;
    await component.ngOnInit();

    const draft: ImportDraft = {
      formatId: 'roster-json',
      name: 'Ma liste',
      forceDisposition: {
        id: 'priority-assets',
        slug: 'priority-assets',
        label: 'Priority Assets',
        importNames: [],
        icon: { viewBox: '0 0 24 24', mode: 'fill', paths: [] },
      },
      units: [unit()],
      sourceFileName: 'roster.json',
    };
    component.draft.set(draft);
  });

  it('mémorise le socle assigné à une ligne porteuse d’une clé RT_25', () => {
    const [group] = component.draft()!.units[0].modelGroups;
    component.assignShape(component.draft()!.units[0], group, 'oval-170x105');

    expect(remember).toHaveBeenCalledWith(
      'skorpius disintegrator::skorpius disintegrator',
      'oval-170x105',
    );
  });

  it('ne mémorise rien pour une unité non reconnue (pas de clé stable)', () => {
    const draft = component.draft()!;
    const unresolved = {
      ...draft.units[0],
      modelGroups: [{ ...draft.units[0].modelGroups[0], overrideKey: undefined }],
    };
    component.draft.set({ ...draft, units: [unresolved] });

    component.assignShape(unresolved, unresolved.modelGroups[0], 'round-32');

    expect(remember).not.toHaveBeenCalled();
  });
});
