import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { LibraryService } from '../../data/library.service';
import { dispositionCounts, dispositionIndicator } from '../../deployment/deployment-status';
import { ArmyList, DispositionIndicator } from '../../models/domain.models';
import { ForceDisposition } from '../../models/referential.models';
import { ReferentialService } from '../../referentials/referential.service';

interface OpponentOption {
  readonly disposition: ForceDisposition;
  /** RG_12: indicateur agrégé sur les 3 plateaux du couple. */
  readonly indicator: DispositionIndicator;
  readonly hint: string;
  /**
   * RG_24: second canal du code couleur — le compte des déploiements terminés
   * sur le nombre de plateaux du couple, et la mention « à reprendre » quand
   * au moins un déploiement est commencé sans être terminé.
   */
  readonly counter: string;
  /** Position sur le cercle, en degrés depuis le haut. */
  readonly angle: number;
  /** Tracé SVG du secteur d'anneau, dans le repère 0–100 du cadran. */
  readonly sector: string;
}

/**
 * Géométrie du cadran, en unités du viewBox 0–100 : un anneau découpé en
 * autant de secteurs que de dispositions adverses, autour d'un disque central
 * qui rappelle la disposition du joueur.
 */
const DIAL_OUTER_RADIUS = 49;
const DIAL_INNER_RADIUS = 21;
/** Rayon médian de l'anneau, où l'on centre le contenu de chaque secteur. */
const DIAL_LABEL_RADIUS = (DIAL_OUTER_RADIUS + DIAL_INNER_RADIUS) / 2;

/** Point du cadran à `radius` et `angle` (degrés, depuis le haut, sens horaire). */
function dialPoint(radius: number, angle: number): string {
  const radians = (angle * Math.PI) / 180;
  const x = 50 + radius * Math.sin(radians);
  const y = 50 - radius * Math.cos(radians);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

/** Secteur d'anneau entre `from` et `to` (degrés, depuis le haut). */
function ringSector(from: number, to: number, outer: number, inner: number): string {
  const large = to - from > 180 ? 1 : 0;
  return [
    `M ${dialPoint(outer, from)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${dialPoint(outer, to)}`,
    `L ${dialPoint(inner, to)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${dialPoint(inner, from)}`,
    'Z',
  ].join(' ');
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
      // RG_24: le compte accompagne la couleur, il ne la remplace pas.
      const counts = dispositionCounts(list, deployments, perPair);
      const counter =
        counts.unfinished > 0
          ? `${counts.finished}/${counts.total} · à reprendre`
          : `${counts.finished}/${counts.total}`;
      const span = 360 / all.length;
      const angle = span * index;
      return {
        disposition,
        indicator,
        hint: INDICATOR_HINTS[indicator],
        counter,
        angle,
        sector: ringSector(angle - span / 2, angle + span / 2, DIAL_OUTER_RADIUS, DIAL_INNER_RADIUS),
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

  readonly innerRadius = DIAL_INNER_RADIUS;

  /**
   * Position du contenu (icône, libellé, compteur) d'un secteur, en
   * pourcentage du conteneur : au milieu de l'anneau, sur la bissectrice du
   * secteur.
   */
  offset(angle: number, axis: 'x' | 'y'): number {
    const radians = ((angle - 90) * Math.PI) / 180;
    return 50 + DIAL_LABEL_RADIUS * (axis === 'x' ? Math.cos(radians) : Math.sin(radians));
  }

  /** Un secteur SVG est activable au clavier comme un bouton. */
  onSectorKey(event: KeyboardEvent, option: OpponentOption): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void this.choose(option);
    }
  }
}
