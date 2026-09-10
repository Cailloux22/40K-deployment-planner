import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular/lazy';

import { LibraryService } from '../data/library.service';
import { ArmyList } from '../models/domain.models';
import { ForceDisposition } from '../models/referential.models';
import { ConnectivityService } from '../net/connectivity.service';
import { SyncService } from '../net/sync.service';
import { ReferentialService } from '../referentials/referential.service';

interface ListCard {
  readonly list: ArmyList;
  readonly disposition?: ForceDisposition;
  readonly unitCount: number;
  readonly modelCount: number;
  readonly deploymentCount: number;
}

/**
 * Écran 1 — Accueil / bibliothèque des listes d'armée importées.
 *
 * Point d'entrée unique de l'application : la bibliothèque des déploiements
 * n'est pas un écran séparé (EX_04), le joueur y accède en cliquant sur une
 * liste puis en suivant le parcours de RG_03.
 *
 * RG_18: un bouton « Réglages » (engrenage) est toujours visible, quel que
 * soit le nombre de listes importées.
 * RG_21: chaque liste offre une suppression (en cascade, confirmée) et une
 * duplication.
 * RG_13/RT_14: l'accès à l'import est bloqué hors-ligne, message explicite.
 */
@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly referential = inject(ReferentialService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly actionSheets = inject(ActionSheetController);

  private readonly dispositions = signal<readonly ForceDisposition[]>([]);

  readonly loaded = this.library.loaded;
  /** RG_13/RT_14: pilote l'état du point d'entrée d'import. */
  readonly online = this.connectivity.online;
  /** RG_11: un conflit en attente est signalé dès l'accueil. */
  readonly hasConflicts = computed(() => this.sync.pendingConflicts().length > 0);

  readonly cards = computed<readonly ListCard[]>(() => {
    const byId = new Map(this.dispositions().map((d) => [d.id, d]));
    return this.library.lists().map((list) => ({
      list,
      disposition: byId.get(list.forceDispositionId),
      unitCount: list.units.length,
      modelCount: list.units.reduce((sum, unit) => sum + unit.modelCount, 0),
      deploymentCount: this.library
        .deploymentsOfList(list.id)
        // RG_14: un déploiement sans aucun placement compte comme absent.
        .filter((deployment) => deployment.placements.length > 0).length,
    }));
  });

  async ngOnInit(): Promise<void> {
    await this.library.load();
    this.dispositions.set(await this.referential.allDispositions());
  }

  /**
   * RG_13/RT_14: hors-ligne, l'import n'est pas lancé — le joueur reçoit un
   * message explicite l'invitant à réessayer une fois reconnecté, sans
   * qu'aucune tentative de parsing n'ait lieu.
   */
  async openImport(): Promise<void> {
    if (!this.online()) {
      const alert = await this.alerts.create({
        header: 'Import indisponible hors-ligne',
        message: this.connectivity.offlineMessage("L'import d'une liste d'armée"),
        buttons: ['Compris'],
      });
      await alert.present();
      return;
    }
    await this.router.navigate(['/import']);
  }

  openSettings(): Promise<boolean> {
    return this.router.navigate(['/settings']);
  }

  /** RG_03: cliquer une liste ouvre l'étape 1 — choix de la disposition adverse. */
  openList(list: ArmyList): Promise<boolean> {
    return this.router.navigate(['/list', list.id, 'adversary']);
  }

  /** RG_21: menu contextuel par liste (dupliquer / supprimer). */
  async openMenu(card: ListCard): Promise<void> {
    const sheet = await this.actionSheets.create({
      header: card.list.name,
      buttons: [
        { text: 'Dupliquer', handler: () => void this.duplicate(card) },
        { text: 'Supprimer', role: 'destructive', handler: () => void this.confirmDelete(card) },
        { text: 'Annuler', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /**
   * RG_21: suppression confirmée explicitement. Si des déploiements
   * référencent la liste, le joueur en est informé avant de confirmer : ils
   * sont supprimés avec elle plutôt que laissés orphelins.
   */
  async confirmDelete(card: ListCard): Promise<void> {
    const linked = this.library.deploymentsOfList(card.list.id).length;
    const message = linked
      ? `« ${card.list.name} » sera supprimée, ainsi que ${linked} déploiement(s) ` +
        `sauvegardé(s) qui l'utilisent. Cette action est définitive.`
      : `« ${card.list.name} » sera supprimée. Cette action est définitive.`;

    const alert = await this.alerts.create({
      header: 'Supprimer cette liste ?',
      message,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Supprimer',
          role: 'destructive',
          handler: () => {
            void this.library.deleteList(card.list.id);
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * RG_21: duplication — copie indépendante, nommée « … (copie) » par
   * défaut et modifiable, sans aucun déploiement associé.
   */
  async duplicate(card: ListCard): Promise<void> {
    const copy = await this.library.duplicateList(card.list.id);
    if (!copy) return;

    const alert = await this.alerts.create({
      header: 'Liste dupliquée',
      message: 'Vous pouvez renommer la copie.',
      inputs: [{ name: 'name', type: 'text', value: copy.name }],
      buttons: [
        { text: 'Garder ce nom', role: 'cancel' },
        {
          text: 'Renommer',
          handler: (data: { name?: string }) => {
            const name = data.name?.trim();
            if (name) void this.library.saveList({ ...copy, name });
          },
        },
      ],
    });
    await alert.present();
  }

  async showOfflineNotice(): Promise<void> {
    const toast = await this.toasts.create({
      message: this.connectivity.offlineMessage("L'import d'une liste d'armée"),
      duration: 4000,
      position: 'bottom',
    });
    await toast.present();
  }
}
