import { ReferentialDatasheet, ReferentialModelLine } from '../models/referential.models';
import {
  findDatasheet,
  findModelLine,
  matchBaseVariant,
  normalizeName,
  tokenOverlap,
} from './base-matching';

function datasheet(
  name: string,
  models: { name: string; baseShapeId: string | null }[],
): ReferentialDatasheet {
  return {
    name,
    key: normalizeName(name),
    models: models.map((model) => ({
      name: model.name,
      key: normalizeName(model.name),
      baseShapeId: model.baseShapeId,
      rawBaseSize: model.baseShapeId ?? 'Use model',
    })),
  };
}

describe('normalizeName — clé de rapprochement RG_02', () => {
  it('ignore la casse, la ponctuation et les accents', () => {
    expect(normalizeName('Tech-Priest Enginseer')).toBe('tech priest enginseer');
    expect(normalizeName("Skitarii Ranger's")).toBe('skitarii rangers');
  });

  it('écarte le détail d’équipement entre parenthèses et après « w/ »', () => {
    expect(normalizeName('Kataphron Breacher (Heavy arc rifle & hydraulic claw)')).toBe(
      'kataphron breacher',
    );
    expect(normalizeName('Skitarii Ranger w/ arc rifle')).toBe('skitarii ranger arc rifle');
  });
});

describe('tokenOverlap — mots significatifs partagés', () => {
  it('neutralise le pluriel et les mots vides', () => {
    expect(tokenOverlap('gun servitor', 'combat servitors and gun servitors')).toBe(2);
  });

  it('renvoie 0 quand rien n’est partagé', () => {
    expect(tokenOverlap('onager dunecrawler', 'kastelan robot')).toBe(0);
  });
});

describe('findDatasheet — RG_02', () => {
  const rangers = datasheet('Skitarii Rangers', [
    { name: 'Skitarii Rangers', baseShapeId: 'round-25' },
  ]);

  it('rapproche un nom importé de sa datasheet', () => {
    expect(findDatasheet([rangers], 'Skitarii Rangers')?.name).toBe('Skitarii Rangers');
  });

  it('renvoie null pour une unité absente du référentiel', () => {
    expect(findDatasheet([rangers], 'Unité inventée')).toBeNull();
  });

  it('accepte des homonymes qui décrivent les mêmes socles', () => {
    const other = datasheet('Skitarii Rangers', [
      { name: 'Skitarii Rangers', baseShapeId: 'round-25' },
    ]);
    expect(findDatasheet([rangers, other], 'Skitarii Rangers')).not.toBeNull();
  });

  it('accepte des homonymes au socle unique commun, aux lignes nommées différemment', () => {
    // Cas réel : « Chaos Terminators » existe en deux datasheets, dont les
    // lignes s'appellent « Chaos Terminators » et « Terminator Squad » —
    // même socle de 40 mm, le choix est donc sans conséquence (RG_02).
    const squad = datasheet('Chaos Terminators', [
      { name: 'Terminator Squad', baseShapeId: 'round-40' },
    ]);
    const terminators = datasheet('Chaos Terminators', [
      { name: 'Chaos Terminators', baseShapeId: 'round-40' },
    ]);
    expect(findDatasheet([squad, terminators], 'Chaos Terminators')).not.toBeNull();
  });

  it('refuse de deviner entre des homonymes aux socles divergents', () => {
    // Le socle partirait alors en assignation manuelle (RG_02), plutôt que
    // d'être choisi au hasard parmi deux datasheets contradictoires.
    const conflicting = datasheet('Skitarii Rangers', [
      { name: 'Skitarii Rangers', baseShapeId: 'round-32' },
    ]);
    expect(findDatasheet([rangers, conflicting], 'Skitarii Rangers')).toBeNull();
  });
});

describe('findModelLine — RG_02', () => {
  it('retient la ligne unique d’une datasheet mono-profil', () => {
    const rangers = datasheet('Skitarii Rangers', [
      { name: 'Skitarii Rangers', baseShapeId: 'round-25' },
    ]);
    // Le nom importé porte l'équipement, le référentiel reste généraliste.
    expect(findModelLine(rangers, 'Skitarii Ranger w/ galvanic rifle')?.baseShapeId).toBe('round-25');
  });

  it('préfère la correspondance exacte d’un profil', () => {
    const clade = datasheet('Servitor Battleclade', [
      { name: 'Servitor Underseer', baseShapeId: 'round-32' },
      { name: 'Combat Servitors and Gun Servitors', baseShapeId: 'round-25' },
    ]);
    expect(findModelLine(clade, 'Servitor Underseer')?.baseShapeId).toBe('round-32');
  });

  it('retombe sur le recouvrement de mots quand aucun nom ne coïncide', () => {
    const clade = datasheet('Servitor Battleclade', [
      { name: 'Servitor Underseer', baseShapeId: 'round-32' },
      { name: 'Combat Servitors and Gun Servitors', baseShapeId: 'round-25' },
    ]);
    expect(findModelLine(clade, 'Combat Servitor w/ meltagun')?.baseShapeId).toBe('round-25');
  });

  it('accepte n’importe quelle ligne quand toutes portent le même socle', () => {
    const same = datasheet('Escouade homogène', [
      { name: 'Profil A', baseShapeId: 'round-40' },
      { name: 'Profil B', baseShapeId: 'round-40' },
    ]);
    expect(findModelLine(same, 'Profil totalement autre')?.baseShapeId).toBe('round-40');
  });

  it('renvoie null quand les socles divergent et qu’aucun rapprochement ne se dégage', () => {
    const ambiguous = datasheet('Escouade ambiguë', [
      { name: 'Profil A', baseShapeId: 'round-40' },
      { name: 'Profil B', baseShapeId: 'round-60' },
    ]);
    expect(findModelLine(ambiguous, 'Zzz inconnu')).toBeNull();
  });

  it('remonte un socle non publié tel quel (baseShapeId null)', () => {
    const useModel = datasheet('Skorpius Disintegrator', [
      { name: 'Skorpius Disintegrator', baseShapeId: null },
    ]);
    expect(findModelLine(useModel, 'Skorpius Disintegrator')?.baseShapeId).toBeNull();
  });
});

describe('matchBaseVariant — RG_02 (socles conditionnels d’une même ligne)', () => {
  function line(
    name: string,
    baseShapeId: string,
    variants: ReferentialModelLine['baseVariants'],
  ): ReferentialModelLine {
    return {
      name,
      key: normalizeName(name),
      baseShapeId,
      rawBaseSize: baseShapeId,
      baseVariants: variants,
    };
  }

  // « Gun servitors 32mm » sur une ligne à 25 mm : « servitor » figurant déjà
  // dans le nom de la datasheet, seul « gun » discrimine (cf. ingestion).
  const servitors = line('Combat Servitors and Gun Servitors', 'round-25', [
    {
      baseShapeId: 'round-32',
      rawBaseSize: '32mm',
      subject: ['gun'],
      conditions: [],
      raw: 'Gun servitors 32mm',
    },
  ]);

  // « 60 x 35mm if equipped with transuranic arquebus » : pas de sujet, une
  // condition d'équipement.
  const rangers = line('Skitarii Rangers', 'round-25', [
    {
      baseShapeId: 'oval-60x35',
      rawBaseSize: '60 x 35mm',
      subject: [],
      conditions: [['transuranic', 'arquebu']],
      raw: '60 x 35mm if equipped with transuranic arquebus',
    },
  ]);

  it('applique la variante au modèle qu’elle désigne', () => {
    expect(matchBaseVariant(servitors, 'Gun Servitor w/ heavy bolter')?.baseShapeId).toBe('round-32');
  });

  it('laisse le socle par défaut aux autres modèles de la ligne', () => {
    expect(matchBaseVariant(servitors, 'Combat Servitor w/ meltagun')).toBeNull();
  });

  it('décide sur l’équipement du profil quand le nom ne le cite pas (RT_13)', () => {
    expect(matchBaseVariant(rangers, 'Skitarii Ranger', ['Transuranic arquebus'])?.baseShapeId).toBe(
      'oval-60x35',
    );
    expect(matchBaseVariant(rangers, 'Skitarii Ranger w/ transuranic arquebus')?.baseShapeId).toBe(
      'oval-60x35',
    );
    expect(matchBaseVariant(rangers, 'Skitarii Ranger', ['Galvanic rifle'])).toBeNull();
  });

  it('exige le sujet ET l’une des conditions quand la note porte les deux', () => {
    const breachers = line('Imperial Navy Breachers', 'round-25', [
      {
        baseShapeId: 'round-28',
        rawBaseSize: '28mm',
        subject: ['navi', 'armsman'],
        conditions: [['meltagun'], ['plasmagun']],
        raw: 'Navis Armsman 28mm if armed with meltagun or plasmagun',
      },
    ]);
    expect(matchBaseVariant(breachers, 'Navis Armsman', ['Plasmagun'])?.baseShapeId).toBe('round-28');
    // Bon modèle, mauvaise arme.
    expect(matchBaseVariant(breachers, 'Navis Armsman', ['Boarding shield'])).toBeNull();
    // Bonne arme, mauvais modèle.
    expect(matchBaseVariant(breachers, 'Navis Breacher', ['Meltagun'])).toBeNull();
  });

  it('ne fait rien sur une ligne sans variante', () => {
    expect(matchBaseVariant(line('Kastelan Robots', 'round-60', undefined), 'Kastelan Robot')).toBeNull();
  });
});
