import { readFileSync } from 'node:fs';

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ReferentialService } from './referential.service';

/**
 * RG_02 vérifié contre le référentiel réellement livré (RT_02) : le service
 * est branché sur les assets du dépôt, pas sur des données inventées, pour
 * que le test échoue si une régénération change le sens de la donnée.
 */
const http = {
  get: (url: string) => of(JSON.parse(readFileSync(`src/${url}`, 'utf8'))),
};

describe('ReferentialService.resolveBaseShapeId — RG_02', () => {
  let service: ReferentialService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: http }],
    });
    service = TestBed.inject(ReferentialService);
  });

  it('résout un profil sans exception vers le socle de sa ligne', async () => {
    await expect(service.resolveBaseShapeId('Kastelan Robots', 'Kastelan Robot')).resolves.toEqual({
      baseShapeId: 'round-60',
    });
  });

  it('applique le socle conditionnel désigné par un nom de modèle', async () => {
    // « Combat Servitors and Gun Servitors » : 25 mm, note « Gun servitors 32mm ».
    const gunner = await service.resolveBaseShapeId(
      'Servitor Battleclade',
      'Gun Servitor w/ heavy bolter',
      ['Heavy bolter', 'Servo-claw'],
    );
    expect(gunner.baseShapeId).toBe('round-32');

    const combat = await service.resolveBaseShapeId(
      'Servitor Battleclade',
      'Combat Servitor w/ meltagun',
      ['Meltagun', 'Servo-claw'],
    );
    expect(combat.baseShapeId).toBe('round-25');
  });

  it('applique le socle conditionnel déclenché par un équipement', async () => {
    // « Skitarii Rangers » : 25 mm, note « 60 x 35mm if equipped with
    // transuranic arquebus ».
    const arquebus = await service.resolveBaseShapeId(
      'Skitarii Rangers',
      'Skitarii Ranger w/ transuranic arquebus',
      ['Close combat weapon', 'Transuranic arquebus'],
    );
    expect(arquebus.baseShapeId).toBe('oval-60x35');

    const galvanic = await service.resolveBaseShapeId(
      'Skitarii Rangers',
      'Skitarii Ranger w/ galvanic rifle',
      ['Close combat weapon', 'Galvanic rifle'],
    );
    expect(galvanic.baseShapeId).toBe('round-25');
  });

  it('renvoie en assignation manuelle une note non interprétable', async () => {
    const resolved = await service.resolveBaseShapeId(
      'Chaos Lord On Steed Of Slaanesh',
      'Chaos Lord On Steed Of Slaanesh',
    );
    expect(resolved.baseShapeId).toBeNull();
    expect(resolved.reason).toMatch(/Seeker base size/);
  });

  it('renvoie en assignation manuelle une unité absente ou sans socle publié', async () => {
    await expect(service.resolveBaseShapeId('Unité inventée', 'Profil')).resolves.toMatchObject({
      baseShapeId: null,
    });
    // `No official base size` : hors périmètre de RT_26, donc non résolu par
    // construction, quelle que soit la couverture du référentiel de gabarits.
    const noBase = await service.resolveBaseShapeId('Spined Chaos Beast', 'Spined Chaos Beast');
    expect(noBase.baseShapeId).toBeNull();
  });

  it('ne mémorise rien d’un appel à l’autre : un profil non résolu le reste', async () => {
    const first = await service.resolveBaseShapeId('Spined Chaos Beast', 'Spined Chaos Beast');
    const second = await service.resolveBaseShapeId('Spined Chaos Beast', 'Spined Chaos Beast');
    expect(first).toEqual(second);
    expect(second.baseShapeId).toBeNull();
  });
});

describe('ReferentialService.resolveBaseShapeId — homonymes (RG_02)', () => {
  let service: ReferentialService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: http }],
    });
    service = TestBed.inject(ReferentialService);
  });

  it('résout une unité en double dans le référentiel quand le socle est le même', async () => {
    // Deux datasheets « Chaos Terminators », lignes « Chaos Terminators » et
    // « Terminator Squad », toutes deux en 40 mm.
    const resolved = await service.resolveBaseShapeId(
      'Chaos Terminators',
      'Combi-bolter, accursed weapon',
    );
    expect(resolved.baseShapeId).toBe('round-40');
  });
});

/**
 * RT_26: fixtures dédiées (plutôt que les assets réels, livrés vides tant
 * qu'aucun gabarit n'a été vérifié) pour couvrir la priorité de résolution
 * sans dépendre du contenu, encore incomplet, de `use-model-footprints.json`.
 */
describe('ReferentialService.resolveBaseShapeId — RT_26', () => {
  let service: ReferentialService;

  const baseReferential = {
    source: { name: 'Test', attribution: '', url: '' },
    generatedAt: '2026-09-10',
    stats: {
      datasheets: 2,
      modelLines: 2,
      resolvedModelLines: 0,
      baseShapes: 0,
      orphanModelLines: 0,
      notedModelLines: 0,
      variantModelLines: 0,
      unparsedBaseNotes: [],
      ambiguousNames: [],
    },
    baseShapes: [],
    datasheets: [
      {
        name: 'Test Vehicle',
        key: 'test vehicle',
        models: [
          { name: 'Test Vehicle', key: 'test vehicle', baseShapeId: null, rawBaseSize: 'Use model' },
        ],
      },
      {
        name: 'Uncovered Vehicle',
        key: 'uncovered vehicle',
        models: [
          {
            name: 'Uncovered Vehicle',
            key: 'uncovered vehicle',
            baseShapeId: null,
            rawBaseSize: 'Use model',
          },
        ],
      },
    ],
  };

  const footprintReferential = {
    generatedAt: '2026-09-10',
    footprints: [
      {
        key: 'test vehicle::test vehicle',
        shape: 'rectangle',
        widthMm: 80,
        lengthMm: 130,
        sourceNote: 'Mesure de test',
      },
    ],
  };

  const fixtureHttp = {
    get: (url: string) => {
      if (url.endsWith('bases.json')) return of(baseReferential);
      if (url.endsWith('use-model-footprints.json')) return of(footprintReferential);
      throw new Error(`URL non gérée par ce test : ${url}`);
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: fixtureHttp }],
    });
    service = TestBed.inject(ReferentialService);
  });

  it('résout automatiquement un « Use model » couvert par un gabarit recherché', async () => {
    const resolved = await service.resolveBaseShapeId('Test Vehicle', 'Test Vehicle');
    expect(resolved.baseShapeId).toBe('use-model:test vehicle::test vehicle');

    const shape = await service.baseShape(resolved.baseShapeId);
    expect(shape).toMatchObject({ shape: 'rectangle', widthMm: 80, lengthMm: 130 });
  });

  it('expose le gabarit parmi les socles proposés pour une assignation manuelle', async () => {
    const shapes = await service.allBaseShapes();
    expect(shapes.some((s) => s.id === 'use-model:test vehicle::test vehicle')).toBe(true);
  });

  it('retombe sur l’assignation manuelle simple quand aucun gabarit ne couvre la ligne', async () => {
    const resolved = await service.resolveBaseShapeId('Uncovered Vehicle', 'Uncovered Vehicle');
    expect(resolved.baseShapeId).toBeNull();
  });
});
