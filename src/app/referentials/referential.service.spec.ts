import { readFileSync } from 'node:fs';

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BaseOverrideService } from './base-override.service';
import { ReferentialService } from './referential.service';

/**
 * RG_02 vérifié contre le référentiel réellement livré (RT_02) : le service
 * est branché sur les assets du dépôt, pas sur des données inventées, pour
 * que le test échoue si une régénération change le sens de la donnée.
 */
const http = {
  get: (url: string) => of(JSON.parse(readFileSync(`src/${url}`, 'utf8'))),
};

/**
 * RT_25: mémorisation en mémoire, sans passer par IndexedDB (indisponible
 * sous jsdom) — seul le contrat de BaseOverrideService compte ici.
 */
class FakeBaseOverrideService {
  private readonly byKey = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.byKey.get(key);
  }

  async remember(key: string, baseShapeId: string): Promise<void> {
    this.byKey.set(key, baseShapeId);
  }
}

describe('ReferentialService.resolveBaseShapeId — RG_02', () => {
  let service: ReferentialService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: BaseOverrideService, useClass: FakeBaseOverrideService },
      ],
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
    const useModel = await service.resolveBaseShapeId(
      'Skorpius Disintegrator',
      'Skorpius Disintegrator',
    );
    expect(useModel.baseShapeId).toBeNull();
    // RT_25: pas de source externe pour ce cas, mais une clé stable est
    // fournie pour qu'une assignation manuelle future puisse s'y rattacher.
    expect(useModel.overrideKey).toBeTruthy();
  });

  it('applique silencieusement un socle « Use model » déjà mémorisé (RT_25)', async () => {
    const first = await service.resolveBaseShapeId(
      'Skorpius Disintegrator',
      'Skorpius Disintegrator',
    );
    expect(first.baseShapeId).toBeNull();
    const overrides = TestBed.inject(BaseOverrideService);
    await overrides.remember(first.overrideKey!, 'round-60');

    const second = await service.resolveBaseShapeId(
      'Skorpius Disintegrator',
      'Skorpius Disintegrator',
    );
    expect(second).toEqual({ baseShapeId: 'round-60', overrideKey: first.overrideKey });
  });

  it('applique silencieusement une note conditionnelle non interprétable déjà mémorisée (RT_25)', async () => {
    const first = await service.resolveBaseShapeId(
      'Chaos Lord On Steed Of Slaanesh',
      'Chaos Lord On Steed Of Slaanesh',
    );
    expect(first.baseShapeId).toBeNull();
    const overrides = TestBed.inject(BaseOverrideService);
    await overrides.remember(first.overrideKey!, 'oval-60x35');

    const second = await service.resolveBaseShapeId(
      'Chaos Lord On Steed Of Slaanesh',
      'Chaos Lord On Steed Of Slaanesh',
    );
    expect(second.baseShapeId).toBe('oval-60x35');
  });
});

describe('ReferentialService.resolveBaseShapeId — homonymes (RG_02)', () => {
  let service: ReferentialService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: BaseOverrideService, useClass: FakeBaseOverrideService },
      ],
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
