import { readFileSync } from 'node:fs';

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BaseOverrideService } from '../referentials/base-override.service';
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

/** RT_25: pas d'IndexedDB sous jsdom — mémorisation en mémoire pour le test. */
const noOverrides = { get: async () => undefined, remember: async () => undefined };

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
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: BaseOverrideService, useValue: noOverrides },
      ],
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
    // « Use model » sur le Skorpius Disintegrator : au joueur de trancher.
    expect(service.unresolvedGroups(draft).map((entry) => entry.unit.name)).toEqual([
      'Skorpius Disintegrator',
    ]);
    expect(service.isDraftComplete(draft)).toBe(false);
  });

  it('porte une clé de mémorisation sur le socle non publié (RT_25)', () => {
    const { group } = service.unresolvedGroups(draft)[0];
    expect(group.overrideKey).toBeTruthy();
  });
});
