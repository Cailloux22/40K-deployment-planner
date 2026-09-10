import { readFileSync } from 'node:fs';

import {
  BaseReferential,
  BoardReferential,
  DispositionReferential,
  UseModelFootprintReferential,
} from '../models/referential.models';

/**
 * Contrôles d'intégrité des référentiels statiques embarqués, tels que
 * produits par les scripts d'ingestion hors-ligne (RT_02, RT_12) et par
 * l'écriture manuelle de RT_23.
 *
 * Ces tests protègent les hypothèses dont le code dépend : ils échouent si un
 * référentiel est régénéré dans un format que l'application ne sait plus
 * exploiter, plutôt que de laisser l'anomalie se manifester à l'écran.
 */
function load<T>(file: string): T {
  return JSON.parse(readFileSync(`src/assets/referentials/${file}`, 'utf8')) as T;
}

describe('RT_02 — référentiel de socles', () => {
  const referential = load<BaseReferential>('bases.json');

  it('transporte l’attribution requise par sa source (RT_20)', () => {
    expect(referential.source.name).toBe('Wahapedia');
    expect(referential.source.attribution).toBe('Powered by Wahapedia');
  });

  it('contient les datasheets et les socles distincts', () => {
    expect(referential.datasheets.length).toBeGreaterThan(500);
    expect(referential.baseShapes.length).toBeGreaterThan(10);
  });

  it('n’expose que des socles ronds ou ovales, dimensionnés en millimètres', () => {
    for (const shape of referential.baseShapes) {
      expect(['round', 'oval']).toContain(shape.shape);
      expect(shape.widthMm).toBeGreaterThan(0);
      expect(shape.lengthMm).toBeGreaterThanOrEqual(shape.widthMm);
      if (shape.shape === 'round') expect(shape.lengthMm).toBe(shape.widthMm);
    }
  });

  it('ne référence, depuis les profils de modèle, que des socles connus', () => {
    const known = new Set(referential.baseShapes.map((shape) => shape.id));
    for (const sheet of referential.datasheets) {
      for (const model of sheet.models) {
        // `null` est un cas métier légitime : assignation manuelle (RG_02).
        if (model.baseShapeId !== null) expect(known.has(model.baseShapeId)).toBe(true);
      }
    }
  });

  it('résout les socles de la liste de référence utilisée par RT_13', () => {
    const byName = new Map(referential.datasheets.map((sheet) => [sheet.name, sheet]));
    expect(byName.get('Skitarii Rangers')?.models[0].baseShapeId).toBe('round-25');
    expect(byName.get('Kataphron Breachers')?.models[0].baseShapeId).toBe('round-60');
    expect(byName.get('Onager Dunecrawler')?.models[0].baseShapeId).toBe('round-130');
    // « Use model » : aucun socle publié -> assignation manuelle (RG_02).
    expect(byName.get('Skorpius Disintegrator')?.models[0].baseShapeId).toBeNull();
  });

  it('traduit les notes `base_size_descr` en socles conditionnels (RG_02)', () => {
    const byName = new Map(referential.datasheets.map((sheet) => [sheet.name, sheet]));

    // Une ligne de modèle, deux socles : l'arquebuse transuranique passe le
    // porteur en ovale 60 × 35.
    const rangers = byName.get('Skitarii Rangers')?.models[0];
    expect(rangers?.baseShapeId).toBe('round-25');
    expect(rangers?.baseVariants).toEqual([
      {
        baseShapeId: 'oval-60x35',
        rawBaseSize: '60 x 35mm',
        subject: [],
        conditions: [['transuranic', 'arquebu']],
        raw: '60 x 35mm if equipped with transuranic arquebus',
      },
    ]);

    // « Combat Servitors and Gun Servitors » : 25 mm, sauf les Gun Servitors.
    const servitors = byName
      .get('Servitor Battleclade')
      ?.models.find((model) => model.name === 'Combat Servitors and Gun Servitors');
    expect(servitors?.baseShapeId).toBe('round-25');
    expect(servitors?.baseVariants).toEqual([
      {
        baseShapeId: 'round-32',
        rawBaseSize: '32mm',
        subject: ['gun'],
        conditions: [],
        raw: 'Gun servitors 32mm',
      },
    ]);
  });

  it('publie les socles cités par les seules notes conditionnelles', () => {
    const known = new Set(referential.baseShapes.map((shape) => shape.id));
    for (const sheet of referential.datasheets) {
      for (const model of sheet.models) {
        for (const variant of model.baseVariants ?? []) {
          expect(known.has(variant.baseShapeId)).toBe(true);
          // Une variante sans discriminant s'appliquerait à toute la ligne.
          expect(variant.subject.length + variant.conditions.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('renvoie en assignation manuelle les notes non interprétables (RG_02)', () => {
    // Seule tournure que l'ingestion ne tranche pas : la source elle-même
    // pose une question (« ...Seeker base size (60 x 35mm)? »).
    expect(referential.stats.unparsedBaseNotes).toHaveLength(1);
    expect(referential.stats.unparsedBaseNotes[0]).toMatch(/\?$/);
    expect(referential.stats.variantModelLines).toBeGreaterThan(0);
    expect(referential.stats.variantModelLines).toBeLessThanOrEqual(
      referential.stats.notedModelLines,
    );

    const flagged = referential.datasheets
      .flatMap((sheet) => sheet.models)
      .filter((model) => model.baseNoteUnresolved);
    for (const model of flagged) {
      expect(model.baseVariants).toBeUndefined();
      expect(model.baseSizeNote).toBeTruthy();
    }
  });
});

describe('RT_26 — référentiel complémentaire des gabarits « Use model »', () => {
  const referential = load<UseModelFootprintReferential>('use-model-footprints.json');
  const bases = load<BaseReferential>('bases.json');

  it('n’a, à ce stade, aucune entrée non vérifiée — il grossit au fil des recherches', () => {
    // RT_26: ne jamais introduire une dimension qui ne soit pas une mesure
    // vérifiée et sourcée (`sourceNote`) — une entrée non fiable serait pire
    // que l'assignation manuelle qu'elle est censée éviter.
    expect(Array.isArray(referential.footprints)).toBe(true);
  });

  it('ne porte que des gabarits bien formés, chacun avec sa source', () => {
    for (const footprint of referential.footprints) {
      expect(['round', 'oval', 'rectangle']).toContain(footprint.shape);
      expect(footprint.widthMm).toBeGreaterThan(0);
      expect(footprint.lengthMm).toBeGreaterThan(0);
      expect(footprint.sourceNote.trim().length).toBeGreaterThan(0);
    }
  });

  it('n’a pas deux entrées pour la même ligne de référentiel', () => {
    const keys = referential.footprints.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ne couvre que des lignes « Use model » réellement sans socle publié (RT_02)', () => {
    const useModelKeys = new Set(
      bases.datasheets.flatMap((sheet) =>
        sheet.models
          .filter((m) => !m.baseShapeId && m.rawBaseSize?.trim().toLowerCase() === 'use model')
          .map((m) => `${sheet.key}::${m.key}`),
      ),
    );
    for (const footprint of referential.footprints) {
      expect(useModelKeys.has(footprint.key)).toBe(true);
    }
  });
});

describe('RT_12 — référentiel des plateaux', () => {
  const referential = load<BoardReferential>('boards.json');

  it('crédite Battlemaster (RT_20)', () => {
    expect(referential.source.name).toBe('Battlemaster');
    expect(referential.source.attribution).toMatch(/Battlemaster/);
  });

  it('propose exactement 3 plateaux par couple de dispositions (RG_03 étape 2)', () => {
    const perPair = new Map<string, number>();
    for (const board of referential.boards) {
      perPair.set(board.pairKey, (perPair.get(board.pairKey) ?? 0) + 1);
    }
    // 5 dispositions -> 15 couples non ordonnés (5 miroirs + 10 croisés).
    expect(perPair.size).toBe(15);
    for (const count of perPair.values()) expect(count).toBe(3);
  });

  it('livre tous les assets aux mêmes dimensions (hypothèse de RT_19)', () => {
    for (const board of referential.boards) {
      expect(board.width).toBe(referential.assetSize.width);
      expect(board.height).toBe(referential.assetSize.height);
    }
  });

  it('expose les deux variantes attendues par RT_16 pour chaque plateau', () => {
    for (const board of referential.boards) {
      expect(board.assets['with-measurements']).toMatch(/with-measurements/);
      expect(board.assets['no-measurements']).toMatch(/no-measurements/);
    }
  });

  it('mesure une zone de jeu au rapport 44"x60" dans chaque asset (RT_05)', () => {
    expect(referential.boardInches).toEqual({ width: 44, height: 60 });
    for (const board of referential.boards) {
      const ratio = board.playArea.width / board.playArea.height;
      expect(ratio).toBeCloseTo(44 / 60, 2);
      // La zone de jeu est strictement contenue dans l'image.
      expect(board.playArea.left).toBeGreaterThan(0);
      expect(board.playArea.right).toBeLessThan(board.width);
      expect(board.playArea.bottom).toBeLessThan(board.height);
    }
  });

  it('donne un identifiant de plateau unique et stable', () => {
    const ids = referential.boards.map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('RT_23 — référentiel des dispositions de force', () => {
  const referential = load<DispositionReferential>('dispositions.json');
  const boards = load<BoardReferential>('boards.json');

  it('déclare exactement les 5 dispositions manipulées par RG_03', () => {
    expect(referential.dispositions).toHaveLength(5);
    expect(referential.dispositions.map((d) => d.id).sort()).toEqual([
      'disruption',
      'priority-assets',
      'purge-the-foe',
      'reconnaissance',
      'take-and-hold',
    ]);
  });

  it('fournit pour chacune un libellé, un nom d’import et une icône', () => {
    for (const disposition of referential.dispositions) {
      expect(disposition.label.length).toBeGreaterThan(0);
      expect(disposition.importNames.length).toBeGreaterThan(0);
      expect(disposition.icon.paths.length).toBeGreaterThan(0);
      expect(['fill', 'stroke']).toContain(disposition.icon.mode);
    }
  });

  it('couvre, avec le référentiel de plateaux, les 25 combinaisons de dispositions', () => {
    const pairs = new Set(boards.boards.map((board) => board.pairKey));
    for (const player of referential.dispositions) {
      for (const opponent of referential.dispositions) {
        expect(pairs.has([player.id, opponent.id].sort().join('__'))).toBe(true);
      }
    }
  });
});
