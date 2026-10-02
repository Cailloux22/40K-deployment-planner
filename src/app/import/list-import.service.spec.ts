import { readFileSync } from 'node:fs';

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ImportDraft, ListImportService } from './list-import.service';

/**
 * RG_02/RG_16 vérifiés de bout en bout : la fixture d'import de RT_13 est
 * interprétée puis résolue contre les référentiels réellement livrés
 * (RT_02, RT_23), sans mock de donnée métier.
 */
const FIXTURE_PATH = 'src/assets/list_import.example.json';

const http = {
  get: (url: string) => of(JSON.parse(readFileSync(`src/${url}`, 'utf8'))),
};

/** Socles de l'unité, sous la forme affichée par le menu de RG_16. */
function groupsOf(draft: ImportDraft, unitName: string): Record<string, number> {
  const unit = draft.units.find((u) => u.name === unitName);
  const counts: Record<string, number> = {};
  for (const group of unit?.modelGroups ?? []) {
    counts[group.baseShapeId ?? 'non résolu'] = group.count;
  }
  return counts;
}

describe('ListImportService.buildDraft — RG_02/RG_16', () => {
  let service: ListImportService;
  let draft: ImportDraft;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: http }],
    });
    service = TestBed.inject(ListImportService);
    draft = await service.buildDraft('roster.json', readFileSync(FIXTURE_PATH, 'utf8'));
  });

  it('reprend le nom et la disposition de force du roster (RG_22, RT_23)', () => {
    expect(draft.name).toBe('breachers protector');
    expect(draft.forceDisposition.id).toBe('priority-assets');
    expect(draft.units).toHaveLength(14);
  });

  it('sépare les socles conditionnels d’une même unité (RG_16)', () => {
    // 10 Skitarii Rangers : 9 sur socle rond de 25 mm, le porteur
    // d'arquebuse transuranique sur ovale 60 × 35 (note RT_02).
    expect(groupsOf(draft, 'Skitarii Rangers')).toEqual({ 'round-25': 9, 'oval-60x35': 1 });

    // 9 Servitor Battleclade : l'Underseer et les 2 Gun Servitors sur 32 mm,
    // les 6 Combat Servitors sur 25 mm.
    expect(groupsOf(draft, 'Servitor Battleclade')).toEqual({ 'round-32': 3, 'round-25': 6 });
  });

  it('conserve le nombre de modèles annoncé par le roster (RT_13)', () => {
    for (const unit of draft.units) {
      const placed = unit.modelGroups.reduce((sum, group) => sum + group.count, 0);
      expect(placed).toBe(unit.modelCount);
    }
  });

  it('signale les seuls socles non publiés (RG_22)', () => {
    // Le seul socle non publié de cette liste — « Use model » sur le Skorpius
    // Disintegrator — est désormais couvert par le référentiel de gabarits
    // (RT_26) : plus rien ne part en assignation manuelle.
    expect(service.unresolvedGroups(draft).map((entry) => entry.unit.name)).toEqual([]);
    expect(service.isDraftComplete(draft)).toBe(true);
  });

  it('RG_02/RT_28 : un rectangle sur mesure résout le groupe au même titre qu’un socle', () => {
    const unit = draft.units.find((u) => u.name === 'Skorpius Disintegrator')!;
    // Profil ramené en assignation manuelle, comme l'est tout profil que ni
    // RT_02 ni RT_26 ne documentent.
    unit.modelGroups[0].baseShapeId = null;
    expect(service.unresolvedGroups(draft)).toHaveLength(1);

    unit.modelGroups[0].customRectangleMm = { widthMm: 60, lengthMm: 120 };

    expect(service.unresolvedGroups(draft)).toEqual([]);
    expect(service.isDraftComplete(draft)).toBe(true);
  });
});

describe('ListImportService.buildDraft — RG_36/RT_45 (unités attachées)', () => {
  let service: ListImportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: http }],
    });
    service = TestBed.inject(ListImportService);
  });

  it('convertit les attachements du roster en identifiants d’unité', async () => {
    const draft = await service.buildDraft('roster.json', readFileSync(FIXTURE_PATH, 'utf8'));
    const byName = (name: string) => draft.units.find((u) => u.name === name)!;
    expect(byName('Tech-Priest Manipulus').attachment).toEqual({
      bodyguardUnitId: byName('Kataphron Breachers').id,
      role: 'leader',
    });
    expect(byName('Cybernetica Datasmith').attachment).toEqual({
      bodyguardUnitId: byName('Kastelan Robots').id,
      role: 'support',
    });
    expect(draft.units.filter((u) => u.attachment)).toHaveLength(2);
    expect(draft.attachmentIssues).toEqual([]);
  });

  it('signale un attachement illisible sans rejeter la liste (RG_36, RG_01)', async () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const selections = raw.roster.forces[0].selections as { name: string; associations?: { name: string }[] }[];
    selections.find((s) => s.name === 'Tech-Priest Manipulus')!.associations![0].name = 'Escorting';
    const draft = await service.buildDraft('roster.json', JSON.stringify(raw));
    expect(draft.units.find((u) => u.name === 'Tech-Priest Manipulus')!.attachment).toBeUndefined();
    expect(draft.attachmentIssues).toHaveLength(1);
    expect(draft.attachmentIssues[0]).toContain('Tech-Priest Manipulus');
    expect(draft.attachmentIssues[0]).toContain('Kataphron Breachers');
    expect(draft.units).toHaveLength(14);
  });
});
