import { Injectable, inject } from '@angular/core';

import { ArmyList, ArmyUnit, UnitModelGroup } from '../models/domain.models';
import { ForceDisposition } from '../models/referential.models';
import { ReferentialService } from '../referentials/referential.service';
import { newId } from '../data/library.service';
import { autoUnitColor } from './unit-colors';
import { ParsedRoster, RosterParseError, parseRosterJsonText } from './roster-json.parser';

/**
 * RT_01 — couche de parsing des formats d'import, isolée de l'UI.
 *
 * Un parseur par format supporté est déclaré dans `FORMATS` : ajouter un
 * nouveau format n'impose de toucher ni l'écran d'import ni le reste de
 * l'application, seulement cette table.
 */
export interface ImportFormat {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly parse: (text: string) => ParsedRoster;
}

/** RT_13 est, à ce jour, le seul format branché derrière RT_01. */
export const FORMATS: readonly ImportFormat[] = [
  {
    id: 'roster-json',
    label: 'Roster JSON (BattleScribe / NewRecruit)',
    extensions: ['.json'],
    parse: parseRosterJsonText,
  },
];

/**
 * RG_22: brouillon d'import présenté au récapitulatif, avant tout
 * enregistrement. Il porte déjà tout ce que le joueur doit pouvoir corriger :
 * le nom de la liste et les socles non résolus.
 */
export interface ImportDraft {
  readonly formatId: string;
  /** Nom pré-rempli depuis `roster.name` (RT_13), éditable (RG_22). */
  name: string;
  readonly forceDisposition: ForceDisposition;
  readonly units: ArmyUnit[];
  readonly sourceFileName: string;
}

@Injectable({ providedIn: 'root' })
export class ListImportService {
  private readonly referential = inject(ReferentialService);

  readonly formats = FORMATS;

  /** Extensions acceptées par l'input fichier de l'écran d'import. */
  acceptAttribute(): string {
    return this.formats.flatMap((f) => f.extensions).join(',');
  }

  private formatFor(fileName: string): ImportFormat {
    const lower = fileName.toLowerCase();
    const format = this.formats.find((f) => f.extensions.some((ext) => lower.endsWith(ext)));
    if (!format) {
      throw new RosterParseError(
        `Format de fichier non supporté (« ${fileName} »). Formats acceptés : ` +
          `${this.formats.map((f) => f.label).join(', ')}.`,
      );
    }
    return format;
  }

  /**
   * RG_01/RG_02/RG_22: interprète le fichier puis construit le brouillon de
   * récapitulatif. Rien n'est persisté ici — l'enregistrement n'a lieu qu'à
   * la validation explicite du récapitulatif (`LibraryService.saveList`).
   */
  async buildDraft(fileName: string, text: string): Promise<ImportDraft> {
    const format = this.formatFor(fileName);
    // RG_01: une erreur de parsing remonte telle quelle à l'écran, qui
    // l'affiche ; aucune liste partiellement interprétée n'est conservée.
    const roster = format.parse(text);

    // RT_13/RT_23: le libellé textuel de disposition devient un identifiant
    // stable du référentiel de dispositions.
    const disposition = await this.referential.dispositionByImportName(roster.forceDispositionName);
    if (!disposition) {
      throw new RosterParseError(
        `Disposition de force « ${roster.forceDispositionName} » inconnue de l'application. ` +
          `Dispositions attendues : ${(await this.referential.allDispositions())
            .map((d) => d.label)
            .join(', ')}.`,
      );
    }

    const units: ArmyUnit[] = [];
    for (const [index, parsedUnit] of roster.units.entries()) {
      const unitId = newId('unit');

      // RG_02: chaque profil de modèle est résolu séparément vers un socle —
      // une unité peut légitimement mêler plusieurs formes/tailles (RG_16).
      const groups: UnitModelGroup[] = [];
      for (const [groupIndex, profile] of parsedUnit.modelProfiles.entries()) {
        const resolved = await this.referential.resolveBaseShapeId(
          parsedUnit.name,
          profile.name,
          profile.equipment,
        );
        groups.push({
          id: `${unitId}_g${groupIndex}`,
          name: profile.name,
          count: profile.count,
          baseShapeId: resolved.baseShapeId,
          unresolvedReason: resolved.reason,
        });
      }

      units.push({
        id: unitId,
        name: parsedUnit.name,
        modelCount: parsedUnit.modelCount,
        modelGroups: this.mergeIdenticalGroups(unitId, groups),
        // RG_06: couleur distincte attribuée automatiquement, réassignable.
        color: autoUnitColor(index),
      });
    }

    return {
      formatId: format.id,
      name: roster.name,
      forceDisposition: disposition,
      units,
      sourceFileName: fileName,
    };
  }

  /**
   * RG_16: le menu unités regroupe les socles « par forme/taille avec un
   * compte ». Deux profils de modèle qui aboutissent au même socle ne doivent
   * donc pas rester deux groupes distincts.
   *
   * Les groupes non résolus (`baseShapeId === null`) restent séparés : le
   * joueur doit pouvoir leur assigner un socle profil par profil (RG_02).
   */
  private mergeIdenticalGroups(unitId: string, groups: readonly UnitModelGroup[]): UnitModelGroup[] {
    const merged: UnitModelGroup[] = [];
    for (const group of groups) {
      const target = group.baseShapeId
        ? merged.find((m) => m.baseShapeId === group.baseShapeId)
        : undefined;
      if (target) {
        merged.splice(merged.indexOf(target), 1, {
          ...target,
          count: target.count + group.count,
          // Le libellé du groupe fusionné cite les profils qu'il couvre.
          name: `${target.name}, ${group.name}`,
        });
      } else {
        merged.push(group);
      }
    }
    return merged.map((group, index) => ({ ...group, id: `${unitId}_g${index}` }));
  }

  /**
   * RG_02/RT_28: un groupe est résolu soit par un socle du référentiel, soit
   * par un rectangle sur mesure saisi à la main — les deux sont mutuellement
   * exclusifs, mais l'un ou l'autre suffit à sortir le groupe de l'assignation
   * manuelle du récapitulatif.
   */
  private isGroupResolved(group: UnitModelGroup): boolean {
    return group.baseShapeId !== null || group.customRectangleMm !== undefined;
  }

  /** RG_22: le récapitulatif signale les unités à compléter à la main. */
  unresolvedGroups(draft: ImportDraft): { unit: ArmyUnit; group: UnitModelGroup }[] {
    return draft.units.flatMap((unit) =>
      unit.modelGroups.filter((g) => !this.isGroupResolved(g)).map((group) => ({ unit, group })),
    );
  }

  /** RG_22: la liste ne peut être validée qu'une fois tous les socles connus. */
  isDraftComplete(draft: ImportDraft): boolean {
    return draft.name.trim().length > 0 && this.unresolvedGroups(draft).length === 0;
  }

  /** Transforme le brouillon validé en liste persistable (RT_07). */
  toArmyList(draft: ImportDraft): ArmyList {
    const now = new Date().toISOString();
    return {
      id: newId('list'),
      name: draft.name.trim(),
      forceDispositionId: draft.forceDisposition.id,
      units: draft.units,
      importedAt: now,
      updatedAt: now,
      versionToken: null,
      dirty: true,
    };
  }
}
