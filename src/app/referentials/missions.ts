import { MissionCard, MissionReferential, PairMissions } from '../models/referential.models';

/**
 * RT_64: la carte jouée par la disposition `player` contre la disposition
 * `opponent` — fonction pure du référentiel, sans réseau ni stockage.
 */
export function missionFor(
  referential: MissionReferential,
  player: string,
  opponent: string,
): MissionCard | undefined {
  return referential.missions.find((m) => m.disposition === player && m.opponent === opponent);
}

/**
 * RG_48: le couple est ORDONNÉ, contrairement aux plateaux (RT_12) — la
 * mission du joueur est la carte de son jeu prévue contre l'adversaire, celle
 * de l'adversaire la carte du jeu adverse prévue contre le joueur.
 */
export function missionsForPair(
  referential: MissionReferential,
  player: string,
  opponent: string,
): PairMissions {
  return {
    mirror: player === opponent,
    player: missionFor(referential, player, opponent),
    opponent: missionFor(referential, opponent, player),
  };
}
