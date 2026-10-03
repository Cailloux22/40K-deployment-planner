import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';

import { LibraryService } from '../../data/library.service';
import { ImportDraft, ListImportService } from '../../import/list-import.service';
import { ArmyUnit } from '../../models/domain.models';
import { ConnectivityService } from '../../net/connectivity.service';
import { ReferentialService } from '../../referentials/referential.service';
import { ImportPage } from './import.page';

/** RG_02: seule l'assignation manuelle d'un socle est couverte ici. */
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
      },
    ],
    color: '#e6194b',
  };
}

describe('ImportPage.assignShape — RG_02', () => {
  let fixture: ComponentFixture<ImportPage>;
  let component: ImportPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ImportPage],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ListImportService, useValue: { acceptAttribute: () => '.json' } },
        { provide: ReferentialService, useValue: { allBaseShapes: async () => [] } },
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
      attachmentIssues: [],
      splits: [],
    };
    component.draft.set(draft);
  });

  it('assigne le socle choisi au groupe et efface le motif de non-résolution', () => {
    const [group] = component.draft()!.units[0].modelGroups;
    component.assignShape(component.draft()!.units[0], group, 'oval-170x105');

    const [updated] = component.draft()!.units[0].modelGroups;
    expect(updated.baseShapeId).toBe('oval-170x105');
    expect(updated.unresolvedReason).toBeUndefined();
  });

  it('ne modifie pas les autres groupes de l’unité', () => {
    const draft = component.draft()!;
    const other = { ...draft.units[0].modelGroups[0], id: 'u1_g1', baseShapeId: 'round-25' };
    const unresolved = { ...draft.units[0], modelGroups: [draft.units[0].modelGroups[0], other] };
    component.draft.set({ ...draft, units: [unresolved] });

    component.assignShape(unresolved, unresolved.modelGroups[0], 'round-32');

    const groups = component.draft()!.units[0].modelGroups;
    expect(groups.find((g) => g.id === 'u1_g1')?.baseShapeId).toBe('round-25');
  });
});

describe('ImportPage.assignCustomRectangle — RG_02/RT_28', () => {
  let fixture: ComponentFixture<ImportPage>;
  let component: ImportPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ImportPage],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ListImportService, useValue: { acceptAttribute: () => '.json' } },
        { provide: ReferentialService, useValue: { allBaseShapes: async () => [] } },
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
      attachmentIssues: [],
      splits: [],
    };
    component.draft.set(draft);
  });

  it('assigne un rectangle sur mesure et efface le motif de non-résolution', () => {
    const [group] = component.draft()!.units[0].modelGroups;
    component.assignCustomRectangle(component.draft()!.units[0], group, 60, 120);

    const [updated] = component.draft()!.units[0].modelGroups;
    expect(updated.customRectangleMm).toEqual({ widthMm: 60, lengthMm: 120 });
    expect(updated.baseShapeId).toBeNull();
    expect(updated.unresolvedReason).toBeUndefined();
  });

  it('ignore une valeur non strictement positive plutôt que d’assigner un rectangle invalide', () => {
    const [group] = component.draft()!.units[0].modelGroups;
    component.assignCustomRectangle(component.draft()!.units[0], group, 0, 120);
    component.assignCustomRectangle(component.draft()!.units[0], group, 60, -5);

    const [updated] = component.draft()!.units[0].modelGroups;
    expect(updated.customRectangleMm).toBeUndefined();
  });

  it('assignShape efface un rectangle sur mesure déjà saisi (mutuellement exclusifs)', () => {
    const unit0 = component.draft()!.units[0];
    const [group] = unit0.modelGroups;
    component.assignCustomRectangle(unit0, group, 60, 120);

    const withCustom = component.draft()!.units[0];
    component.assignShape(withCustom, withCustom.modelGroups[0], 'round-32');

    const [updated] = component.draft()!.units[0].modelGroups;
    expect(updated.baseShapeId).toBe('round-32');
    expect(updated.customRectangleMm).toBeUndefined();
  });
});
