import { readFileSync } from 'node:fs';

import { MissionReferential } from '../models/referential.models';
import { missionFor, missionsForPair } from './missions';

/**
 * RT_64 / RG_48 vérifiés contre le référentiel réellement livré : une
 * régénération qui changerait le sens de la donnée fait échouer ces tests.
 */
const referential = JSON.parse(
  readFileSync('src/assets/referentials/missions.json', 'utf8'),
) as MissionReferential;
const dispositions = (
  JSON.parse(readFileSync('src/assets/referentials/dispositions.json', 'utf8')) as {
    dispositions: { id: string }[];
  }
).dispositions.map((d) => d.id);

describe('missions primaires (RT_64 / RG_48)', () => {
  it('couvre la matrice 5 × 5 : une carte par couple ordonné, sans doublon', () => {
    expect(referential.missions).toHaveLength(dispositions.length ** 2);
    for (const player of dispositions) {
      for (const opponent of dispositions) {
        expect(missionFor(referential, player, opponent), `${player} contre ${opponent}`).toBeDefined();
      }
    }
    expect(new Set(referential.missions.map((m) => m.id)).size).toBe(referential.missions.length);
  });

  it('résout un couple ordonné : chaque joueur joue la carte de son propre jeu', () => {
    const pair = missionsForPair(referential, 'purge-the-foe', 'priority-assets');
    expect(pair.mirror).toBe(false);
    expect(pair.player?.name).toBe("Destroyer's Wrath");
    expect(pair.opponent?.name).toBe('Vital Link');

    // L'ordre inverse inverse les deux cartes.
    const reversed = missionsForPair(referential, 'priority-assets', 'purge-the-foe');
    expect(reversed.player?.id).toBe(pair.opponent?.id);
    expect(reversed.opponent?.id).toBe(pair.player?.id);
  });

  it('dans un couple miroir, les deux joueurs jouent la même carte', () => {
    const pair = missionsForPair(referential, 'purge-the-foe', 'purge-the-foe');
    expect(pair.mirror).toBe(true);
    expect(pair.player?.name).toBe('Meatgrinder');
    expect(pair.opponent?.id).toBe(pair.player?.id);
  });

  it("rend une carte absente plutôt qu'une carte devinée", () => {
    const partial: MissionReferential = {
      ...referential,
      missions: referential.missions.filter((m) => m.id !== 'priority-assets/vital-link'),
    };
    const pair = missionsForPair(partial, 'purge-the-foe', 'priority-assets');
    expect(pair.player?.name).toBe("Destroyer's Wrath");
    expect(pair.opponent).toBeUndefined();
  });

  it('chaque carte porte son image embarquée, son URL distante et ses dimensions (RT_65)', () => {
    for (const card of referential.missions) {
      expect(card.asset).toBe(`assets/referentials/missions/${card.id}.png`);
      expect(card.remoteAsset).toBe(`https://gdmissions.app/assets/11th/primary-missions/${card.id}.png`);
      expect(card.width).toBeGreaterThan(0);
      expect(card.height).toBeGreaterThan(0);
    }
    expect(referential.source.attribution).toBeTruthy();
  });

  it('porte le verso des seules cartes qui en déclarent un, aux conventions de RT_64', () => {
    const withBack = referential.missions.filter((m) => m.back).map((m) => m.id);
    expect(withBack.sort()).toEqual(
      [
        'reconnaissance/gather-intel',
        'reconnaissance/surveil-the-foe',
        'reconnaissance/triangulation',
        'priority-assets/extract-relic',
        'priority-assets/sabotage',
        'priority-assets/secure-asset',
        'priority-assets/vanguard-operation',
        'priority-assets/vital-link',
        'disruption/death-trap',
        'disruption/locate-and-deny',
        'disruption/smoke-and-mirrors',
      ].sort(),
    );
    for (const card of referential.missions) {
      if (!card.back) continue;
      expect(card.back.asset).toBe(`assets/referentials/missions/${card.id}-back.png`);
      expect(card.back.remoteAsset).toBe(`https://gdmissions.app/assets/11th/primary-missions/${card.id}-back.png`);
    }
  });
});
