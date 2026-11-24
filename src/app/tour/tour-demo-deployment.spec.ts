import { readFileSync } from 'node:fs';

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { validAttachments } from '../deployment/attachments';
import { isDeploymentComplete } from '../deployment/deployment-status';
import { assetPixelsPerMm, resolveGroupShape } from '../deployment/token-geometry';
import { coherencyBase, isCoherent } from '../deployment/unit-coherency';
import { canSplit } from '../import/unit-split';
import { ImportDraft, ListImportService } from '../import/list-import.service';
import { ArmyList, Deployment } from '../models/domain.models';
import { BaseShape, Board } from '../models/referential.models';
import { ReferentialService } from '../referentials/referential.service';
import { DemoDeployment, demoDeployment } from './tour-demo-deployment';

/**
 * RG_65/RT_84: le déploiement d'exemple, calculé sur la liste d'exemple et les
 * référentiels réellement livrés, sans mock de donnée métier.
 */
const FIXTURE_PATH = 'src/assets/list_import.example.json';

const http = {
  get: (url: string) => of(JSON.parse(readFileSync(`src/${url}`, 'utf8'))),
};

describe('Liste et déploiement d’exemple de la visite — RG_65/RT_84', () => {
  let draft: ImportDraft;
  let list: ArmyList;
  let shapes: ReadonlyMap<string, BaseShape>;
  let board: Board;
  let pixelsPerMm: number;
  let demo: DemoDeployment;

  beforeAll(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    const imports = TestBed.inject(ListImportService);
    const referential = TestBed.inject(ReferentialService);
    draft = await imports.buildDraft('list_import.example.json', readFileSync(FIXTURE_PATH, 'utf8'));
    list = imports.toArmyList(draft);
    shapes = new Map((await referential.allBaseShapes()).map((shape) => [shape.id, shape]));
    const [opponent] = await referential.allDispositions();
    [board] = await referential.boardsForPair(list.forceDispositionId, opponent.id);
    pixelsPerMm = assetPixelsPerMm(board, await referential.boardReferential());
    demo = demoDeployment({ units: list.units, shapes, board, pixelsPerMm })!;
  });

  it('trouve dans la fixture ce que les étapes 7 à 12 supposent (RT_84)', () => {
    const unit = (name: string) => draft.units.find((candidate) => candidate.name === name)!;
    expect(unit('Skitarii Rangers').modelGroups.length).toBeGreaterThan(1);
    expect(imports().unresolvedGroups(draft)).toEqual([]);
    const attachments = validAttachments(draft.units);
    expect(attachments.get(unit('Tech-Priest Manipulus').id)).toEqual({
      bodyguardUnitId: unit('Kataphron Breachers').id,
      role: 'leader',
    });
    expect(canSplit(unit('Sicarian Ruststalkers'))).toBe(true);
  });

  it('pose tous les modèles sauf ceux d’une unité indépendante laissée dans le bandeau', () => {
    expect(demo.pendingGroup.units).toHaveLength(1);
    const pendingId = demo.pendingGroup.units[0].id;
    expect(demo.placements.some((placement) => placement.idUnite === pendingId)).toBe(false);
    for (const unit of list.units) {
      if (unit.id === pendingId) continue;
      const placed = new Set(demo.placements.filter((p) => p.idUnite === unit.id).map((p) => p.idModele));
      expect(placed.size, unit.name).toBe(unit.modelCount);
    }
  });

  it('pose chaque unité en cohésion (RG_26)', () => {
    const shapeOfModel = new Map<string, BaseShape>();
    for (const unit of list.units) {
      for (const group of unit.modelGroups) {
        const shape = resolveGroupShape(group, shapes)!;
        for (let index = 0; index < group.count; index += 1) shapeOfModel.set(`${group.id}#${index}`, shape);
      }
    }
    for (const unit of list.units) {
      const bases = demo.placements
        .filter((placement) => placement.idUnite === unit.id)
        .map((placement) => coherencyBase(placement, shapeOfModel.get(placement.idModele)!, pixelsPerMm));
      if (bases.length > 0) expect(isCoherent(bases), unit.name).toBe(true);
    }
  });

  it('reste dans le rectangle de jeu du plateau', () => {
    const { left, top, right, bottom } = board.playArea;
    for (const placement of demo.placements) {
      expect(placement.x).toBeGreaterThan(left);
      expect(placement.x).toBeLessThan(right);
      expect(placement.y).toBeGreaterThan(top);
      expect(placement.y).toBeLessThan(bottom);
    }
  });

  it('est orange à l’étape 21 et vert après la mise en réserve de l’étape 38 (RG_14)', () => {
    const deployment = {
      placements: demo.placements,
      reservedUnitIds: [] as string[],
    } as Deployment;
    expect(isDeploymentComplete(list, deployment)).toBe(false);
    const reserved = { ...deployment, reservedUnitIds: demo.pendingGroup.units.map((unit) => unit.id) };
    expect(isDeploymentComplete(list, reserved)).toBe(true);
  });

  it('est déterministe', () => {
    expect(demoDeployment({ units: list.units, shapes, board, pixelsPerMm })!.placements).toEqual(demo.placements);
  });
});

function imports(): ListImportService {
  return TestBed.inject(ListImportService);
}
