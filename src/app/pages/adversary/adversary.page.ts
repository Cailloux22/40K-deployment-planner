import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { LibraryService } from '../../data/library.service';
import { dispositionIndicator } from '../../deployment/deployment-status';
import { ArmyList, DispositionIndicator } from '../../models/domain.models';
import { ForceDisposition } from '../../models/referential.models';
import { ReferentialService } from '../../referentials/referential.service';

interface OpponentOption {
  readonly disposition: ForceDisposition;
  /** RG_12: indicateur agrégé sur les 3 plateaux du couple. */
  readonly indicator: DispositionIndicator;
  readonly hint: string;
  /** Position sur le cercle, en degrés depuis le haut. */
  readonly angle: number;
}

const INDICATOR_HINTS: Record<DispositionIndicator, string> = {
  white: 'Aucun déploiement commencé',
  yellow: 'Déploiement(s) terminé(s), plateaux restants libres',
  orange: 'Déploiement commencé à reprendre',
  green: 'Les 3 déploiements sont terminés',
};

/**
 * Écran 3 — Choix de la disposition adverse (RG_03 étape 1).
 *
 * La disposition du joueur est déjà connue : elle est fixée dès l'import de la
 * liste (RG_02) et n'est pas redemandée ici — elle occupe le centre du
 * sélecteur, non cliquable, entourée des 5 dispositions adverses proposées par
 * le référentiel RT_23.
 *
 * RG_12/RT_11: chaque bouton porte un code couleur agrégé sur les 3 plateaux
 * du couple, recalculé à chaque affichage depuis les déploiements locaux, sans
 * appel réseau. Cet indicateur est informatif : il n'empêche jamais de créer
 * un nouveau déploiement.
 */
@Component({
  selector: 'app-adversary',
  templateUrl: 'adversary.page.html',
  styleUrls: ['adversary.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdversaryPage implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly referential = inject(ReferentialService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly listId = signal<string>('');
  private readonly dispositions = signal<readonly ForceDisposition[]>([]);
  /** Nombre de plateaux par couple, lu du référentiel plutôt que supposé. */
  private readonly boardsPerPair = signal(3);

  readonly list = computed<ArmyList | undefined>(() => this.library.list(this.listId()));

  readonly playerDisposition = computed<ForceDisposition | undefined>(() => {
    const list = this.list();
    return list ? this.dispositions().find((d) => d.id === list.forceDispositionId) : undefined;
  });

  readonly options = computed<readonly OpponentOption[]>(() => {
    const list = this.list();
    const all = this.dispositions();
    if (!list || all.length === 0) return [];

    const perPair = this.boardsPerPair();
    return all.map((disposition, index) => {
      // RT_11 étape 1: filtrage sur le couple (liste, disposition adverse).
      const deployments = this.library
        .deploymentsOfList(list.id)
        .filter((deployment) => deployment.opponentDispositionId === disposition.id);
      const indicator = dispositionIndicator(list, deployments, perPair);
      return {
        disposition,
        indicator,
        hint: INDICATOR_HINTS[indicator],
        angle: (360 / all.length) * index,
      };
    });
  });

  async ngOnInit(): Promise<void> {
    this.listId.set(this.route.snapshot.paramMap.get('listId') ?? '');
    await this.library.load();

    if (!this.list()) {
      // La liste a pu être supprimée entre-temps (RG_21) : on ne laisse pas
      // le parcours de RG_03 démarrer sans liste.
      await this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }

    this.dispositions.set(await this.referential.allDispositions());

    const player = this.playerDisposition();
    if (player) {
      const boards = await this.referential.boardsForPair(player.id, player.id);
      if (boards.length) this.boardsPerPair.set(boards.length);
    }
  }

  /** RG_03: l'étape 2 (choix du plateau) n'est accessible qu'après ce choix. */
  choose(option: OpponentOption): Promise<boolean> {
    return this.router.navigate([
      '/list',
      this.listId(),
      'adversary',
      option.disposition.id,
      'boards',
    ]);
  }

  back(): Promise<boolean> {
    return this.router.navigate(['/home']);
  }

  /** Position d'un bouton sur le cercle, en pourcentage du conteneur. */
  offset(angle: number, axis: 'x' | 'y'): number {
    const radians = ((angle - 90) * Math.PI) / 180;
    const radius = 38;
    return 50 + radius * (axis === 'x' ? Math.cos(radians) : Math.sin(radians));
  }
}
