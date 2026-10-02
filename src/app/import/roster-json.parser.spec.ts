import { readFileSync } from 'node:fs';

import { RosterParseError, parseRosterJson, parseRosterJsonText } from './roster-json.parser';

/**
 * RT_13: `src/assets/list_import.example.json` est le jeu de données de
 * référence de ce parseur.
 */
const FIXTURE_PATH = 'src/assets/list_import.example.json';

function fixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

describe('parseRosterJson — RT_13 (roster JSON BattleScribe / NewRecruit)', () => {
  it('extrait roster.name, pré-remplissage du récapitulatif d’import (RG_22)', () => {
    expect(parseRosterJson(fixture()).name).toBe('breachers protector');
  });

  it('extrait la disposition de force depuis le nœud « Force Disposition »', () => {
    // RT_13: sous-sélection avec from = "group" et group = "Force Disposition".
    expect(parseRosterJson(fixture()).forceDispositionName).toBe('Priority Assets');
  });

  it('exclut les catégories de configuration de type « upgrade »', () => {
    const names = parseRosterJson(fixture()).units.map((unit) => unit.name);
    // RT_13: Battle Size, Detachment et Force Disposition ne sont pas des unités.
    expect(names).not.toContain('Battle Size');
    expect(names).not.toContain('Detachment');
    expect(names).not.toContain('Force Disposition');
    expect(names).toContain('Belisarius Cawl');
    expect(names).toContain('Skitarii Rangers');
  });

  it('compte 14 unités déployables dans la liste de référence', () => {
    expect(parseRosterJson(fixture()).units).toHaveLength(14);
  });

  it('prend `number` pour une entrée de type « model »', () => {
    const unit = parseRosterJson(fixture()).units.find((u) => u.name === 'Belisarius Cawl');
    expect(unit?.modelCount).toBe(1);
    expect(unit?.modelProfiles).toEqual([
      {
        name: 'Belisarius Cawl',
        count: 1,
        equipment: [
          'Arc scourge',
          "Cawl's Omnissian axe",
          'Mechadendrite hive',
          'Solar atomiser',
        ],
      },
    ]);
  });

  it('remonte l’équipement de chaque profil, dont dépendent certains socles (RG_02)', () => {
    const rangers = parseRosterJson(fixture()).units.find((u) => u.name === 'Skitarii Rangers');

    // RT_02: « 60 x 35mm if equipped with transuranic arquebus » se décide
    // sur cet équipement, que le nom du profil ne cite pas toujours.
    const arquebus = rangers?.modelProfiles.find((p) => p.equipment.includes('Transuranic arquebus'));
    expect(arquebus?.name).toBe('Skitarii Ranger w/ transuranic arquebus');
    expect(arquebus?.count).toBe(1);

    const galvanic = rangers?.modelProfiles.find(
      (p) => p.name === 'Skitarii Ranger w/ galvanic rifle',
    );
    expect(galvanic?.equipment).toEqual(['Close combat weapon', 'Galvanic rifle']);
  });

  it('somme les `number` des profils pour une entrée de type « unit »', () => {
    const units = parseRosterJson(fixture()).units;

    // Skitarii Rangers : 1 + 1 + 1 + 1 + 1 + 5 = 10 modèles sur 6 profils.
    const rangers = units.find((u) => u.name === 'Skitarii Rangers');
    expect(rangers?.modelCount).toBe(10);
    expect(rangers?.modelProfiles).toHaveLength(6);

    // Sicarian Ruststalkers : 1 princeps + 9 troupes.
    expect(units.find((u) => u.name === 'Sicarian Ruststalkers')?.modelCount).toBe(10);

    // Servitor Battleclade : 1 + 1 + 1 + 2 + 1 + 3 = 9 modèles.
    expect(units.find((u) => u.name === 'Servitor Battleclade')?.modelCount).toBe(9);
  });

  it('trouve les profils regroupés sous un nœud « upgrade » d’option', () => {
    // Cas réel (Jakhals) : les 8 modèles de troupe ne sont pas enfants
    // directs de l'unité mais de l'option d'armement choisie.
    const raw = {
      roster: {
        name: 'jakhals',
        forces: [
          {
            selections: [
              {
                type: 'upgrade',
                name: 'Force Disposition',
                selections: [{ from: 'group', group: 'Force Disposition', name: 'Priority Assets' }],
              },
              {
                type: 'unit',
                name: 'Jakhals',
                number: 1,
                selections: [
                  { type: 'model', name: 'Jakhal Pack Leader', number: 1 },
                  { type: 'model', name: 'Dishonoured w/ paired manglers', number: 1 },
                  {
                    type: 'upgrade',
                    name: '8 chainblades',
                    number: 1,
                    selections: [
                      {
                        type: 'model',
                        name: 'Jakhal',
                        number: 8,
                        selections: [{ type: 'upgrade', name: 'Autopistol', number: 8 }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const unit = parseRosterJson(raw).units[0];
    expect(unit.modelCount).toBe(10);
    expect(unit.modelProfiles.map((p) => `${p.name} ×${p.count}`)).toEqual([
      'Jakhal Pack Leader ×1',
      'Dishonoured w/ paired manglers ×1',
      'Jakhal ×8',
    ]);
    // Le nœud d'option décrit l'armement du profil qu'il porte (RG_02).
    expect(unit.modelProfiles[2].equipment).toEqual(['8 chainblades', 'Autopistol']);
  });

  it('ne consomme que id/name/number/type — les coûts et profils sont ignorés', () => {
    const unit = parseRosterJson(fixture()).units[0];
    // RT_45: l'`id` de sélection ne sert qu'à résoudre les attachements.
    expect(Object.keys(unit).sort()).toEqual(['modelCount', 'modelProfiles', 'name', 'selectionId']);
  });
});

describe('parseRosterJson — RT_45 (unités attachées)', () => {
  it('lit les associations sortantes de la liste de référence, rôle compris', () => {
    const roster = parseRosterJson(fixture());
    const nameOf = new Map(roster.units.map((unit) => [unit.selectionId, unit.name]));
    const links = roster.attachments.map((a) => [
      nameOf.get(a.characterSelectionId),
      a.role,
      nameOf.get(a.bodyguardSelectionId),
    ]);
    expect(links).toEqual([
      ['Cybernetica Datasmith', 'support', 'Kastelan Robots'],
      ['Tech-Priest Manipulus', 'leader', 'Kataphron Breachers'],
    ]);
  });

  /** Roster minimal : un personnage, une unité escortée, une association. */
  function rosterWith(association: Record<string, unknown>): unknown {
    const model = (id: string, name: string) => ({ id, name, type: 'model', number: 1 });
    return {
      roster: {
        name: 'Test',
        forces: [
          {
            selections: [
              {
                type: 'upgrade',
                name: 'Force Disposition',
                selections: [{ from: 'group', group: 'Force Disposition', name: 'Priority Assets' }],
              },
              { ...model('c1', 'Captain'), associations: [association] },
              model('b1', 'Intercessors'),
            ],
          },
        ],
      },
    };
  }

  it('ne devine pas le rôle d’une association de nom inconnu', () => {
    const roster = parseRosterJson(rosterWith({ type: 'outgoing', to: 'b1', name: 'Escorting' }));
    expect(roster.attachments).toEqual([
      { characterSelectionId: 'c1', bodyguardSelectionId: 'b1', role: null, associationName: 'Escorting' },
    ]);
  });

  it('ne lit que les associations sortantes', () => {
    const roster = parseRosterJson(rosterWith({ type: 'incoming', from: 'b1', name: 'Leading' }));
    expect(roster.attachments).toEqual([]);
  });
});

describe('parseRosterJson — RG_01 (rejet explicite des imports non interprétables)', () => {
  it('rejette un JSON qui n’est pas un roster', () => {
    expect(() => parseRosterJson({ hello: 'world' })).toThrow(RosterParseError);
    expect(() => parseRosterJson({ hello: 'world' })).toThrow(/roster/i);
  });

  it('rejette un texte qui n’est pas du JSON', () => {
    expect(() => parseRosterJsonText('<xml/>')).toThrow(RosterParseError);
    expect(() => parseRosterJsonText('<xml/>')).toThrow(/illisible/i);
  });

  it('rejette un roster sans nom', () => {
    expect(() => parseRosterJson({ roster: { forces: [] } })).toThrow(/nom/i);
  });

  it('rejette un roster sans nœud « Force Disposition »', () => {
    const raw = {
      roster: {
        name: 'sans disposition',
        forces: [{ selections: [{ type: 'model', name: 'Warboss', number: 1 }] }],
      },
    };
    expect(() => parseRosterJson(raw)).toThrow(/Force Disposition/);
  });

  it('rejette un roster dont la disposition n’est pas sélectionnée', () => {
    const raw = {
      roster: {
        name: 'disposition vide',
        forces: [
          {
            selections: [
              { type: 'upgrade', name: 'Force Disposition', selections: [] },
              { type: 'model', name: 'Warboss', number: 1 },
            ],
          },
        ],
      },
    };
    expect(() => parseRosterJson(raw)).toThrow(/disposition de force/i);
  });

  it('rejette une unité sans profil de modèle — nombre de socles inconnu', () => {
    const raw = {
      roster: {
        name: 'unité vide',
        forces: [
          {
            selections: [
              {
                type: 'upgrade',
                name: 'Force Disposition',
                selections: [{ name: 'Disruption', from: 'group', group: 'Force Disposition' }],
              },
              { type: 'unit', name: 'Escouade fantôme', number: 1, selections: [] },
            ],
          },
        ],
      },
    };
    expect(() => parseRosterJson(raw)).toThrow(/aucun profil de modèle/i);
  });

  it('rejette un nombre de modèles illisible plutôt que de deviner', () => {
    const raw = {
      roster: {
        name: 'compte invalide',
        forces: [
          {
            selections: [
              {
                type: 'upgrade',
                name: 'Force Disposition',
                selections: [{ name: 'Disruption', from: 'group', group: 'Force Disposition' }],
              },
              { type: 'model', name: 'Warboss', number: 'beaucoup' },
            ],
          },
        ],
      },
    };
    expect(() => parseRosterJson(raw)).toThrow(/Nombre de modèles illisible/i);
  });

  it('rejette un roster sans aucune unité déployable', () => {
    const raw = {
      roster: {
        name: 'configuration seule',
        forces: [
          {
            selections: [
              {
                type: 'upgrade',
                name: 'Force Disposition',
                selections: [{ name: 'Disruption', from: 'group', group: 'Force Disposition' }],
              },
              { type: 'upgrade', name: 'Battle Size', number: 1 },
            ],
          },
        ],
      },
    };
    expect(() => parseRosterJson(raw)).toThrow(/aucune unité déployable/i);
  });
});
