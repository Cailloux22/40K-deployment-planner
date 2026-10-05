import { ArmyList, ArmyUnit, Deployment, Placement, UnitModelGroup } from '../models/domain.models';
import {
  boardStatus,
  dispositionIndicator,
  isDeploymentComplete,
  isUnitDeployed,
  isUnitFullyPlaced,
  modelId,
  modelIdsOfUnit,
  isGroupDeployed,
  reservedUnitIds,
  unitMenuView,
  unitMenuViews,
} from './deployment-status';

function group(id: string, count: number, baseShapeId: string | null): UnitModelGroup {
  return { id, name: id, count, baseShapeId };
}

function unit(id: string, groups: UnitModelGroup[], color = '#e6194b'): ArmyUnit {
  return {
    id,
    name: `Unité ${id}`,
    modelCount: groups.reduce((sum, g) => sum + g.count, 0),
    modelGroups: groups,
    color,
  };
}

function list(units: ArmyUnit[]): ArmyList {
  return {
    id: 'list_1',
    name: 'Liste de test',
    forceDispositionId: 'priority-assets',
    units,
    importedAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    versionToken: null,
    dirty: true,
  };
}

function deployment(
  placements: Placement[],
  boardId = 'board_1',
  reserved: string[] = [],
): Deployment {
  return {
    id: `depl_${boardId}`,
    name: 'Déploiement de test',
    listId: 'list_1',
    opponentDispositionId: 'disruption',
    boardId,
    placements,
    reservedUnitIds: reserved,
    note: '',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    versionToken: null,
    dirty: true,
  };
}

function place(unitId: string, ids: string[]): Placement[] {
  return ids.map((idModele, index) => ({
    idUnite: unitId,
    idModele,
    x: 300 + index,
    y: 900 + index,
    rotation: 0,
  }));
}

describe('RG_05 / RT_04 — unité en attente de déploiement', () => {
  const u = unit('u1', [group('u1_g0', 3, 'round-32')]);

  it('reste incomplète tant que tous ses modèles ne sont pas placés', () => {
    const ids = modelIdsOfUnit(u);
    expect(isUnitFullyPlaced(u, place('u1', ids.slice(0, 2)))).toBe(false);
    expect(isUnitFullyPlaced(u, place('u1', ids))).toBe(true);
  });

  it('ne compte qu’une fois un modèle repositionné (idModele distincts)', () => {
    const duplicated = [...place('u1', ['u1_g0#0']), ...place('u1', ['u1_g0#0'])];
    expect(isUnitFullyPlaced(u, duplicated)).toBe(false);
  });

  it('ignore les placements appartenant à une autre unité', () => {
    expect(isUnitFullyPlaced(u, place('u2', modelIdsOfUnit(u)))).toBe(false);
  });
});

describe('RG_14 / RT_11 étape 2 — statut individuel d’un plateau', () => {
  const u = unit('u1', [group('u1_g0', 2, 'round-32')]);
  const armyList = list([u]);

  it('rouge quand aucun déploiement n’existe pour le triplet', () => {
    expect(boardStatus(armyList, undefined)).toBe('missing');
  });

  it('rouge quand un déploiement existe mais sans aucun placement', () => {
    expect(boardStatus(armyList, deployment([]))).toBe('missing');
  });

  it('RG_45: une note de plan de jeu seule laisse le déploiement rouge', () => {
    expect(boardStatus(armyList, { ...deployment([]), note: 'Tenir le centre.' })).toBe('missing');
  });

  it('orange quand des placements existent mais que la liste est incomplète', () => {
    expect(boardStatus(armyList, deployment(place('u1', ['u1_g0#0'])))).toBe('unfinished');
  });

  it('vert quand toutes les unités ont tous leurs modèles placés', () => {
    const complete = deployment(place('u1', ['u1_g0#0', 'u1_g0#1']));
    expect(boardStatus(armyList, complete)).toBe('done');
    expect(isDeploymentComplete(armyList, complete)).toBe(true);
  });

  it('reste orange si une seule unité de la liste est incomplète', () => {
    const two = list([u, unit('u2', [group('u2_g0', 1, 'round-40')])]);
    const partial = deployment(place('u1', ['u1_g0#0', 'u1_g0#1']));
    expect(boardStatus(two, partial)).toBe('unfinished');
  });
});

describe('RG_12 / RT_11 étape 1 — indicateur agrégé par disposition adverse', () => {
  const u = unit('u1', [group('u1_g0', 2, 'round-32')]);
  const armyList = list([u]);
  const full = () => place('u1', ['u1_g0#0', 'u1_g0#1']);
  const partial = () => place('u1', ['u1_g0#0']);

  it('blanc : aucun déploiement commencé sur les 3 plateaux', () => {
    expect(dispositionIndicator(armyList, [])).toBe('white');
    expect(dispositionIndicator(armyList, [deployment([], 'b1')])).toBe('white');
  });

  it('jaune : 1 ou 2 déploiements terminés, aucun commencé non terminé', () => {
    expect(dispositionIndicator(armyList, [deployment(full(), 'b1')])).toBe('yellow');
    expect(
      dispositionIndicator(armyList, [deployment(full(), 'b1'), deployment(full(), 'b2')]),
    ).toBe('yellow');
  });

  it('vert : les 3 déploiements sont terminés', () => {
    expect(
      dispositionIndicator(armyList, [
        deployment(full(), 'b1'),
        deployment(full(), 'b2'),
        deployment(full(), 'b3'),
      ]),
    ).toBe('green');
  });

  it('orange : au moins un déploiement commencé mais non terminé', () => {
    expect(dispositionIndicator(armyList, [deployment(partial(), 'b1')])).toBe('orange');
  });

  it('orange est prioritaire sur vert (RG_12 : Orange > Vert > Jaune > Blanc)', () => {
    // Deux plateaux terminés et un interrompu : le travail interrompu prime.
    expect(
      dispositionIndicator(armyList, [
        deployment(full(), 'b1'),
        deployment(full(), 'b2'),
        deployment(partial(), 'b3'),
      ]),
    ).toBe('orange');
  });
});

describe('RG_16 / RT_18 — regroupement par socle et statut du menu unités', () => {
  // L'exemple de RG_16 : 10 socles de 40 mm, 9 de 20 mm, 1 ovale 20x40.
  const groups = [
    group('u1_g0', 10, 'round-40'),
    group('u1_g1', 9, 'round-20'),
    group('u1_g2', 1, 'oval-40x20'),
  ];
  const u = unit('u1', groups);

  it('expose un groupe par forme/taille avec son compte', () => {
    const view = unitMenuView(u, []);
    expect(view.groups.map((g) => [g.group.baseShapeId, g.total])).toEqual([
      ['round-40', 10],
      ['round-20', 9],
      ['oval-40x20', 1],
    ]);
  });

  it('blanc : aucun modèle de l’unité n’est encore placé', () => {
    const view = unitMenuView(u, []);
    expect(view.status).toBe('white');
    expect(view.placedCount).toBe(0);
  });

  it('orange : au moins un modèle placé, au moins un groupe incomplet', () => {
    const view = unitMenuView(u, place('u1', [modelId(groups[0], 0), modelId(groups[1], 0)]));
    expect(view.status).toBe('orange');
    expect(view.placedCount).toBe(2);
    expect(view.groups[0].placed).toBe(1);
    expect(view.groups[1].placed).toBe(1);
    expect(view.groups[2].placed).toBe(0);
  });

  it('vert : tous les modèles de tous les groupes sont placés', () => {
    const view = unitMenuView(u, place('u1', modelIdsOfUnit(u)));
    expect(view.status).toBe('green');
    expect(view.placedCount).toBe(20);
    expect(view.groups.every((g) => g.placed === g.total)).toBe(true);
  });

  it('compte les modèles placés dans le bon groupe de socles', () => {
    const view = unitMenuView(
      u,
      place('u1', [modelId(groups[1], 0), modelId(groups[1], 1), modelId(groups[2], 0)]),
    );
    expect(view.groups.map((g) => g.placed)).toEqual([0, 2, 1]);
  });
});

describe('RG_25 / RT_35 — mise en réserve d’une unité', () => {
  const u1 = unit('u1', [group('u1_g0', 3, 'round-32')]);
  const u2 = unit('u2', [group('u2_g0', 2, 'round-32')]);
  const armyList = list([u1, u2]);

  it('lit la réserve d’un enregistrement écrit avant RT_35 comme vide', () => {
    const { reservedUnitIds: _absent, ...legacy } = deployment([]);
    expect(reservedUnitIds(legacy as Deployment).size).toBe(0);
    expect(boardStatus(armyList, legacy as Deployment)).toBe('missing');
  });

  it('une unité en réserve n’est plus en attente de déploiement (RG_05)', () => {
    const reserved = new Set(['u1']);
    expect(isUnitDeployed(u1, [], reserved)).toBe(true);
    expect(isUnitDeployed(u2, [], reserved)).toBe(false);
    // La réserve ne fabrique aucun placement (RT_04).
    expect(isUnitFullyPlaced(u1, [])).toBe(false);
  });

  it('un déploiement est terminé quand le reste des unités est en réserve', () => {
    const depl = deployment(place('u1', modelIdsOfUnit(u1)), 'board_1', ['u2']);
    expect(isDeploymentComplete(armyList, depl)).toBe(true);
    expect(boardStatus(armyList, depl)).toBe('done');
  });

  it('une réserve seule suffit à sortir du statut « manquant » (RG_14)', () => {
    const depl = deployment([], 'board_1', ['u1']);
    expect(boardStatus(armyList, depl)).toBe('unfinished');
    expect(dispositionIndicator(armyList, [depl])).toBe('orange');
  });

  it('un déploiement vraiment vide reste manquant', () => {
    expect(boardStatus(armyList, deployment([], 'board_1', []))).toBe('missing');
    expect(dispositionIndicator(armyList, [deployment([], 'board_1', [])])).toBe('white');
  });

  it('trois plateaux terminés par la réserve donnent le vert agrégé (RG_12)', () => {
    const full = (boardId: string) =>
      deployment(place('u1', modelIdsOfUnit(u1)), boardId, ['u2']);
    expect(dispositionIndicator(armyList, [full('b1'), full('b2'), full('b3')])).toBe('green');
  });

  it('le menu affiche une unité en réserve comme complète, comptes réels à l’appui', () => {
    const view = unitMenuView(u1, [], new Set(['u1']));
    expect(view.reserved).toBe(true);
    expect(view.status).toBe('green');
    // RG_24: le compte reste celui des modèles réellement posés — c'est la
    // mention « en réserve » qui explique le vert, pas un compte gonflé.
    expect(view.placedCount).toBe(0);
    expect(view.groups[0].placed).toBe(0);
  });

  it('sortir une unité de la réserve la remet en attente', () => {
    expect(unitMenuView(u1, [], new Set()).status).toBe('white');
    expect(isUnitDeployed(u1, [], new Set())).toBe(false);
  });
});

describe('RG_37 / RT_46 — unité attachée au menu et dans les statuts', () => {
  const leader: ArmyUnit = { ...unit('l', [group('l_g0', 1, 'round-40')], '#111111'), attachment: { bodyguardUnitId: 'b', role: 'leader' } };
  const bodyguard = unit('b', [group('b_g0', 4, 'round-40'), group('b_g1', 1, 'round-50')], '#222222');
  const other = unit('o', [group('o_g0', 2, 'round-32')]);
  const armyList = list([leader, bodyguard, other]);

  it('présente l’unité attachée comme une seule entrée du menu', () => {
    const views = unitMenuViews(armyList, []);
    expect(views.map((v) => v.deploymentGroup.name)).toEqual(['Unité l + Unité b', 'Unité o']);
    expect(views[0].deploymentGroup.modelCount).toBe(6);
  });

  it('réunit les modèles de composantes différentes qui partagent un socle', () => {
    const view = unitMenuViews(armyList, place('l', ['l_g0#0']).concat(place('b', ['b_g0#0'])))[0];
    expect(view.groups.map((g) => [g.group.baseShapeId, g.placed, g.total])).toEqual([
      ['round-40', 2, 5],
      ['round-50', 0, 1],
    ]);
    // RG_06: deux couleurs de composante sur un même socle — pas de couleur unique.
    expect(view.groups[0].color).toBeNull();
    expect(view.groups[1].color).toBe('#222222');
    expect(view.placedCount).toBe(2);
    expect(view.status).toBe('orange');
  });

  it('n’est complète que lorsque toutes ses composantes sont posées', () => {
    const [attached] = unitMenuViews(armyList, []).map((v) => v.deploymentGroup);
    const bodyguardOnly = place('b', modelIdsOfUnit(bodyguard));
    expect(isGroupDeployed(attached, bodyguardOnly)).toBe(false);
    expect(isGroupDeployed(attached, [...bodyguardOnly, ...place('l', modelIdsOfUnit(leader))])).toBe(true);
  });

  it('est en réserve dès que l’une de ses composantes l’est', () => {
    const [attached] = unitMenuViews(armyList, []).map((v) => v.deploymentGroup);
    expect(isGroupDeployed(attached, [], new Set(['l']))).toBe(true);
    expect(unitMenuViews(armyList, [], new Set(['b']))[0].reserved).toBe(true);
  });
});
