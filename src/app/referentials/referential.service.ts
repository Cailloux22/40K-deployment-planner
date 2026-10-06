import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import {
  BaseReferential,
  BaseShape,
  Board,
  BoardReferential,
  BoardTerrain,
  DispositionReferential,
  ForceDisposition,
  MissionReferential,
  PairMissions,
  ReferentialSource,
  TerrainReferential,
  UseModelFootprintReferential,
} from '../models/referential.models';
import {
  findDatasheet,
  findModelLine,
  matchBaseVariant,
  normalizeName,
} from './base-matching';
import { missionsForPair } from './missions';

/**
 * Accès aux référentiels statiques embarqués (RT_02, RT_12, RT_23).
 *
 * EX_05: les trois fichiers sont des assets locaux livrés avec l'application,
 * lus une seule fois puis gardés en mémoire — aucun appel réseau, donc
 * disponibles hors-ligne. RT_02/RT_12: ils sont lus comme des fichiers à part
 * (et non importés dans le bundle JS) précisément pour pouvoir être remplacés
 * indépendamment du code lors d'une mise à jour d'errata.
 */
@Injectable({ providedIn: 'root' })
export class ReferentialService {
  private readonly http = inject(HttpClient);

  private bases?: Promise<BaseReferential>;
  private footprints?: Promise<UseModelFootprintReferential>;
  private boards?: Promise<BoardReferential>;
  private dispositions?: Promise<DispositionReferential>;
  private terrains?: Promise<TerrainReferential>;
  private missions?: Promise<MissionReferential>;

  private load<T>(file: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`assets/referentials/${file}`));
  }

  baseReferential(): Promise<BaseReferential> {
    return (this.bases ??= this.load<BaseReferential>('bases.json'));
  }

  /** RT_26: référentiel complémentaire des gabarits « Use model ». */
  footprintReferential(): Promise<UseModelFootprintReferential> {
    return (this.footprints ??= this.load<UseModelFootprintReferential>('use-model-footprints.json'));
  }

  boardReferential(): Promise<BoardReferential> {
    return (this.boards ??= this.load<BoardReferential>('boards.json'));
  }

  dispositionReferential(): Promise<DispositionReferential> {
    return (this.dispositions ??= this.load<DispositionReferential>('dispositions.json'));
  }

  // -------------------------------------------------------------------------
  // RT_23 — dispositions de force
  // -------------------------------------------------------------------------

  async allDispositions(): Promise<readonly ForceDisposition[]> {
    return (await this.dispositionReferential()).dispositions;
  }

  async disposition(id: string): Promise<ForceDisposition | undefined> {
    return (await this.allDispositions()).find((d) => d.id === id);
  }

  /**
   * RT_13/RT_23: fait correspondre le libellé « Force Disposition » extrait
   * d'un roster importé à un identifiant stable de disposition.
   */
  async dispositionByImportName(name: string): Promise<ForceDisposition | undefined> {
    const key = normalizeName(name);
    return (await this.allDispositions()).find(
      (d) => d.importNames.some((n) => normalizeName(n) === key) || normalizeName(d.label) === key,
    );
  }

  // -------------------------------------------------------------------------
  // RT_02 — socles
  // -------------------------------------------------------------------------

  /** RT_26: identifiant synthétique d'un socle dérivé d'un gabarit recherché. */
  private static footprintShapeId(key: string): string {
    return `use-model:${key}`;
  }

  /**
   * RT_26: les socles de [[RT_02]] (`bases.json`, non modifié) complétés par
   * les gabarits recherchés manuellement, exposés comme des `BaseShape`
   * synthétiques pour que le reste de l'application (rendu des tokens,
   * assignation manuelle) n'ait pas à distinguer les deux origines.
   */
  private async mergedBaseShapes(): Promise<readonly BaseShape[]> {
    const [{ baseShapes }, { footprints }] = await Promise.all([
      this.baseReferential(),
      this.footprintReferential(),
    ]);
    const fromFootprints: BaseShape[] = footprints.map((footprint) => ({
      id: ReferentialService.footprintShapeId(footprint.key),
      shape: footprint.shape,
      widthMm: footprint.widthMm,
      lengthMm: footprint.lengthMm,
      flying: false,
      label: `${footprint.widthMm} x ${footprint.lengthMm}mm (${footprint.sourceNote})`,
    }));
    return [...baseShapes, ...fromFootprints];
  }

  async baseShape(id: string | null): Promise<BaseShape | undefined> {
    if (!id) return undefined;
    return (await this.mergedBaseShapes()).find((s) => s.id === id);
  }

  /** Socles proposés au joueur pour une assignation manuelle (RG_02). */
  async allBaseShapes(): Promise<readonly BaseShape[]> {
    const shapes = await this.mergedBaseShapes();
    return [...shapes].sort(
      (a, b) => a.shape.localeCompare(b.shape) || a.lengthMm - b.lengthMm || a.widthMm - b.widthMm,
    );
  }

  /**
   * RG_02: résout un profil de modèle importé vers un identifiant de socle.
   * `null` signale une unité que le joueur devra compléter à la main sur
   * l'écran d'import — jamais un socle deviné, et jamais mémorisé d'un
   * import à l'autre : un profil non résolu (hors [[RT_26]]) repart en
   * assignation manuelle à chaque import qui le rencontre.
   */
  async resolveBaseShapeId(
    unitName: string,
    modelName: string,
    equipment: readonly string[] = [],
  ): Promise<{ baseShapeId: string | null; reason?: string }> {
    const { datasheets } = await this.baseReferential();

    const datasheet = findDatasheet(datasheets, unitName);
    if (!datasheet) {
      return { baseShapeId: null, reason: `Unité « ${unitName} » absente du référentiel` };
    }

    const line = findModelLine(datasheet, modelName);
    if (!line) {
      return {
        baseShapeId: null,
        reason: `Profil « ${modelName} » non rapproché des socles de « ${datasheet.name} »`,
      };
    }

    // RG_02: une ligne du référentiel peut couvrir des modèles aux socles
    // différents ; l'exception l'emporte sur le socle par défaut.
    const variant = matchBaseVariant(line, modelName, equipment);
    if (variant) return { baseShapeId: variant.baseShapeId };

    // RT_02: note de socle présente mais non interprétable — le socle par
    // défaut pourrait ne pas s'appliquer à ce modèle, on ne devine pas.
    if (line.baseNoteUnresolved) {
      return {
        baseShapeId: null,
        reason:
          `Socle conditionnel pour « ${line.name} » (« ${line.baseSizeNote} ») : ` +
          `à confirmer par le joueur`,
      };
    }

    if (!line.baseShapeId) {
      // RT_26: pour un « Use model » précisément, un gabarit recherché
      // manuellement peut résoudre le profil sans solliciter le joueur.
      if (line.rawBaseSize?.trim().toLowerCase() === 'use model') {
        const key = `${datasheet.key}::${line.key}`;
        const footprint = (await this.footprintReferential()).footprints.find((f) => f.key === key);
        if (footprint) {
          return { baseShapeId: ReferentialService.footprintShapeId(footprint.key) };
        }
      }

      return {
        baseShapeId: null,
        reason: line.rawBaseSize
          ? `Socle non publié pour « ${line.name} » (« ${line.rawBaseSize} »)`
          : `Socle non publié pour « ${line.name} »`,
      };
    }
    return { baseShapeId: line.baseShapeId };
  }

  // -------------------------------------------------------------------------
  // RT_12 — plateaux
  // -------------------------------------------------------------------------

  /**
   * RG_03 étape 2: les 3 plateaux du couple (disposition du joueur,
   * disposition adverse). Le référentiel indexe les couples de façon non
   * ordonnée : le même triplet d'images sert quel que soit le camp.
   */
  async boardsForPair(
    playerDispositionId: string,
    opponentDispositionId: string,
  ): Promise<readonly Board[]> {
    const referential = await this.boardReferential();
    const key = [playerDispositionId, opponentDispositionId].sort().join('__');
    return referential.boards
      .filter((b) => b.pairKey === key)
      .slice()
      .sort((a, b) => a.index - b.index);
  }

  async board(boardId: string): Promise<Board | undefined> {
    return (await this.boardReferential()).boards.find((b) => b.id === boardId);
  }

  /** RT_19: dimensions communes à tous les plateaux du référentiel. */
  async assetSize(): Promise<{ width: number; height: number }> {
    return (await this.boardReferential()).assetSize;
  }

  // -------------------------------------------------------------------------
  // RT_37 — terrain des plateaux
  // -------------------------------------------------------------------------

  terrainReferential(): Promise<TerrainReferential> {
    return (this.terrains ??= this.load<TerrainReferential>('terrain.json'));
  }

  /**
   * RT_37: terrain d'un plateau, ou `null` s'il n'est pas décrit — ce qui ne
   * veut pas dire que le plateau n'a pas de terrain (RG_29).
   */
  async terrain(boardId: string): Promise<BoardTerrain | null> {
    return (await this.terrainReferential()).boards[boardId] ?? null;
  }

  // -------------------------------------------------------------------------
  // RT_64 — missions primaires
  // -------------------------------------------------------------------------

  missionReferential(): Promise<MissionReferential> {
    return (this.missions ??= this.load<MissionReferential>('missions.json'));
  }

  /** RG_48: mission du joueur et mission adverse du couple ordonné. */
  async missionsForPair(
    playerDispositionId: string,
    opponentDispositionId: string,
  ): Promise<PairMissions> {
    return missionsForPair(await this.missionReferential(), playerDispositionId, opponentDispositionId);
  }

  // -------------------------------------------------------------------------
  // RT_20 — mentions des sources tierces
  // -------------------------------------------------------------------------

  /**
   * RG_18/RT_20: énumère les référentiels générés hors-ligne effectivement
   * embarqués dans le build courant et renvoie l'attribution que chacun
   * transporte. Un nouveau référentiel généré apparaîtra ici sans modifier
   * l'écran Réglages, à condition d'être ajouté à cette énumération de
   * fichiers — le texte d'attribution, lui, n'est jamais codé en dur.
   */
  async attributions(): Promise<readonly ReferentialSource[]> {
    const referentials = await Promise.all([
      this.baseReferential().then((r) => r.source),
      this.boardReferential().then((r) => r.source),
      // RG_49/RT_64: crédit des cartes de mission, quelle que soit la
      // provenance de l'image affichée.
      this.missionReferential().then((r) => r.source),
    ]);
    // Une même source pourrait alimenter deux référentiels : on ne la cite
    // qu'une fois.
    const byName = new Map<string, ReferentialSource>();
    for (const source of referentials) {
      if (source?.attribution) byName.set(source.name, source);
    }
    return [...byName.values()];
  }
}
