import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/lazy';

import { LibraryService } from '../../data/library.service';
import { ImportDraft, ListImportService } from '../../import/list-import.service';
import { RosterParseError } from '../../import/roster-json.parser';
import { selectableUnitColors } from '../../import/unit-colors';
import { ArmyUnit, UnitModelGroup } from '../../models/domain.models';
import { BaseShape } from '../../models/referential.models';
import { ConnectivityService } from '../../net/connectivity.service';
import { BaseOverrideService } from '../../referentials/base-override.service';
import { ReferentialService } from '../../referentials/referential.service';

interface UnitRow {
  readonly unit: ArmyUnit;
  readonly groups: readonly { group: UnitModelGroup; shape?: BaseShape }[];
  readonly unresolved: number;
}

/**
 * Écran 2 — Import de liste.
 *
 * Un seul écran couvre le choix du fichier, le récapitulatif (RG_22) et
 * l'assignation manuelle des socles non résolus (RG_02) : il n'existe pas
 * d'écran séparé pour cette assignation.
 *
 * RG_13/RT_14: l'import est bloqué avant toute tentative de parsing lorsque
 * l'application est hors-ligne.
 * RG_01: un fichier non interprétable est rejeté avec un message explicite, et
 * aucune liste partiellement interprétée n'est conservée.
 */
@Component({
  selector: 'app-import',
  templateUrl: 'import.page.html',
  styleUrls: ['import.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportPage implements OnInit {
  private readonly imports = inject(ListImportService);
  private readonly referential = inject(ReferentialService);
  private readonly overrides = inject(BaseOverrideService);
  private readonly library = inject(LibraryService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);

  private readonly shapesById = signal<ReadonlyMap<string, BaseShape>>(new Map());

  readonly online = this.connectivity.online;
  readonly accept = this.imports.acceptAttribute();
  readonly availableShapes = signal<readonly BaseShape[]>([]);
  readonly colors = selectableUnitColors();

  readonly draft = signal<ImportDraft | null>(null);
  readonly parsing = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  /** RG_22: récapitulatif — nombre d'unités, de modèles, socles par unité. */
  readonly rows = computed<readonly UnitRow[]>(() => {
    const draft = this.draft();
    if (!draft) return [];
    const shapes = this.shapesById();
    return draft.units.map((unit) => ({
      unit,
      groups: unit.modelGroups.map((group) => ({
        group,
        shape: group.baseShapeId ? shapes.get(group.baseShapeId) : undefined,
      })),
      unresolved: unit.modelGroups.filter((g) => !g.baseShapeId).length,
    }));
  });

  readonly totalModels = computed(() =>
    (this.draft()?.units ?? []).reduce((sum, unit) => sum + unit.modelCount, 0),
  );

  /** RG_02/RG_22: liste des socles restant à assigner à la main. */
  readonly unresolvedCount = computed(() => {
    const draft = this.draft();
    return draft ? this.imports.unresolvedGroups(draft).length : 0;
  });

  /** RG_22: la validation n'est possible qu'une fois le récapitulatif complet. */
  readonly canConfirm = computed(() => {
    const draft = this.draft();
    return draft !== null && !this.saving() && this.imports.isDraftComplete(draft);
  });

  async ngOnInit(): Promise<void> {
    const shapes = await this.referential.allBaseShapes();
    this.availableShapes.set(shapes);
    this.shapesById.set(new Map(shapes.map((shape) => [shape.id, shape])));
  }

  /**
   * RG_13/RT_14: le gate hors-ligne est vérifié ici, avant toute lecture ou
   * tentative de parsing du fichier choisi.
   */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!this.online()) {
      this.error.set(this.connectivity.offlineMessage("L'import d'une liste d'armée"));
      return;
    }

    this.parsing.set(true);
    this.error.set(null);
    this.draft.set(null);
    try {
      const text = await file.text();
      this.draft.set(await this.imports.buildDraft(file.name, text));
    } catch (err) {
      // RG_01: message explicite, rien n'est enregistré.
      this.error.set(
        err instanceof RosterParseError
          ? err.message
          : `Import impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}.`,
      );
    } finally {
      this.parsing.set(false);
    }
  }

  /** RG_22: le nom pré-rempli depuis `roster.name` reste modifiable. */
  onNameChange(value: string): void {
    const draft = this.draft();
    if (draft) this.draft.set({ ...draft, name: value });
  }

  /**
   * RG_02: assignation manuelle d'un socle, directement dans le récapitulatif.
   *
   * RT_25: quand la ligne de référentiel est reconnue mais ne publie pas de
   * socle (`overrideKey` présent), ce choix est aussi mémorisé pour ne plus
   * être redemandé aux imports suivants du même profil.
   */
  assignShape(unit: ArmyUnit, group: UnitModelGroup, baseShapeId: string): void {
    const draft = this.draft();
    if (!draft) return;
    this.draft.set({
      ...draft,
      units: draft.units.map((candidate) =>
        candidate.id !== unit.id
          ? candidate
          : {
              ...candidate,
              modelGroups: candidate.modelGroups.map((g) =>
                g.id === group.id ? { ...g, baseShapeId, unresolvedReason: undefined } : g,
              ),
            },
      ),
    });
    if (group.overrideKey) void this.overrides.remember(group.overrideKey, baseShapeId);
  }

  /** RG_06: réassignation manuelle de la couleur d'une unité. */
  assignColor(unit: ArmyUnit, color: string): void {
    const draft = this.draft();
    if (!draft) return;
    this.draft.set({
      ...draft,
      units: draft.units.map((candidate) =>
        candidate.id === unit.id ? { ...candidate, color } : candidate,
      ),
    });
  }

  shapeLabel(shape?: BaseShape): string {
    if (!shape) return 'Socle à assigner';
    return shape.label;
  }

  /**
   * RG_22: enregistrement effectif de la liste, uniquement après validation
   * explicite de ce récapitulatif.
   */
  async confirm(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.canConfirm()) return;

    this.saving.set(true);
    try {
      await this.library.saveList(this.imports.toArmyList(draft));
      await this.router.navigate(['/home'], { replaceUrl: true });
    } finally {
      this.saving.set(false);
    }
  }

  /** RG_22: annulation — rien n'est enregistré. */
  async cancel(): Promise<void> {
    if (!this.draft()) {
      await this.router.navigate(['/home']);
      return;
    }
    const alert = await this.alerts.create({
      header: 'Abandonner cet import ?',
      message: 'La liste ne sera pas enregistrée.',
      buttons: [
        { text: 'Continuer l’import', role: 'cancel' },
        {
          text: 'Abandonner',
          role: 'destructive',
          handler: () => {
            this.draft.set(null);
            void this.router.navigate(['/home']);
          },
        },
      ],
    });
    await alert.present();
  }
}
