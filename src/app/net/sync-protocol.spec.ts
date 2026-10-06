import { ArmyList, Deployment } from '../models/domain.models';
import { SyncPullResult } from '../models/sync.models';
import {
  buildPushBatches,
  fingerprint,
  fromWireDeployment,
  planPullPage,
  sameContent,
  toWireDeployment,
  toWireList,
  uuid,
} from './sync-protocol';

function list(id: string, patch: Partial<ArmyList> = {}): ArmyList {
  return {
    id,
    name: `Liste ${id}`,
    forceDispositionId: 'priority-assets',
    units: [
      {
        id: `${id}_u0`,
        name: 'Skitarii Rangers',
        modelCount: 10,
        modelGroups: [
          { id: `${id}_u0_g0`, name: 'Ranger', count: 10, baseShapeId: null, unresolvedReason: '25mm ?' },
        ],
        color: '#e6194b',
      },
    ],
    importedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    versionToken: '3',
    dirty: false,
    ...patch,
  };
}

function deployment(id: string, listId: string, patch: Partial<Deployment> = {}): Deployment {
  return {
    id,
    name: `Déploiement ${id}`,
    listId,
    opponentDispositionId: 'priority-assets',
    boardId: 'board-1',
    placements: [{ idUnite: `${listId}_u0`, idModele: `${listId}_u0_g0#1`, x: 10, y: 20, rotation: 0 }],
    reservedUnitIds: [],
    note: '',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    versionToken: '4',
    dirty: false,
    ...patch,
  };
}

function page(patch: Partial<SyncPullResult> = {}): SyncPullResult {
  return {
    lists: [],
    deployments: [],
    deletedListIds: [],
    deletedDeploymentIds: [],
    nextToken: '10',
    hasMore: false,
    ...patch,
  };
}

describe('RT_68 — conversion local ↔ contrat', () => {
  it("n'envoie ni l'indicateur local `dirty` ni le libellé d'affichage `unresolvedReason`", () => {
    const wire = toWireList(list('list_a', { dirty: true }));
    expect('dirty' in wire).toBe(false);
    expect('unresolvedReason' in wire.units[0].modelGroups[0]).toBe(false);
    expect(wire.versionToken).toBe('3');
  });

  it('lit un déploiement reçu sans note comme une note vide (RT_60)', () => {
    const { note: _note, ...wire } = toWireDeployment(deployment('depl_a', 'list_a'));
    const local = fromWireDeployment(wire, '9');
    expect(local.note).toBe('');
    expect(local.versionToken).toBe('9');
    expect(local.dirty).toBe(false);
  });

  it('compare le contenu sans tenir compte du jeton ni des champs nuls', () => {
    const a = toWireList(list('list_a'));
    const b = { ...a, versionToken: '42', units: a.units.map((u) => ({ ...u, attachment: undefined })) };
    expect(sameContent(a, b)).toBe(true);
    expect(sameContent(a, { ...a, name: 'Autre' })).toBe(false);
  });
});

describe('RT_68 — application d’une page de pull', () => {
  it("n'écrase jamais un enregistrement modifié localement", () => {
    const local = list('list_a', { dirty: true, name: 'Modifiée ici' });
    const plan = planPullPage(page({ lists: [toWireList(list('list_a', { name: 'Modifiée ailleurs', versionToken: '7' }))] }), {
      lists: [local],
      deployments: [],
      tombstoneIds: new Set(),
    });
    expect(plan.lists).toEqual([]);
  });

  it('reconnaît une écriture de cet appareil déjà acceptée et la marque synchronisée', () => {
    const local = list('list_a', { dirty: true, versionToken: null });
    const plan = planPullPage(page({ lists: [{ ...toWireList(local), versionToken: '12' }] }), {
      lists: [local],
      deployments: [],
      tombstoneIds: new Set(),
    });
    expect(plan.lists).toHaveLength(1);
    expect(plan.lists[0].versionToken).toBe('12');
    expect(plan.lists[0].dirty).toBe(false);
  });

  it('ne ressuscite pas un enregistrement supprimé localement et pas encore poussé', () => {
    const plan = planPullPage(page({ deployments: [toWireDeployment(deployment('depl_a', 'list_a'))] }), {
      lists: [],
      deployments: [],
      tombstoneIds: new Set(['depl_a']),
    });
    expect(plan.deployments).toEqual([]);
  });

  it("n'écrit pas en orphelin un déploiement reçu pour une liste supprimée ici", () => {
    const plan = planPullPage(page({ deployments: [toWireDeployment(deployment('depl_b', 'list_a'))] }), {
      lists: [],
      deployments: [],
      tombstoneIds: new Set(['list_a']),
    });
    expect(plan.deployments).toEqual([]);
  });

  it('garde une liste supprimée ailleurs tant que l’un de ses déploiements est modifié ici', () => {
    const plan = planPullPage(page({ deletedListIds: ['list_a'] }), {
      lists: [list('list_a')],
      deployments: [deployment('depl_a', 'list_a', { dirty: true })],
      tombstoneIds: new Set(),
    });
    expect(plan.deletedListIds).toEqual([]);
    expect(plan.deletedDeploymentIds).toEqual([]);
  });

  it('supprime une liste avec ses déploiements locaux non modifiés (RG_21)', () => {
    const plan = planPullPage(page({ deletedListIds: ['list_a'] }), {
      lists: [list('list_a')],
      deployments: [deployment('depl_a', 'list_a'), deployment('depl_b', 'list_b')],
      tombstoneIds: new Set(),
    });
    expect(plan.deletedListIds).toEqual(['list_a']);
    expect(plan.deletedDeploymentIds).toEqual(['depl_a']);
  });
});

describe('RT_68 — découpage de la poussée', () => {
  it('envoie les suppressions avec leur jeton de base et leur date', () => {
    const [batch] = buildPushBatches('8', [], [], [
      { id: 'list_a', resourceType: 'list', deletedAt: '2026-10-02T08:00:00.000Z', versionToken: '3' },
    ]);
    expect(batch.since).toBe('8');
    expect(batch.deletions).toEqual([
      { resourceType: 'list', id: 'list_a', versionToken: '3', deletedAt: '2026-10-02T08:00:00.000Z' },
    ]);
  });

  it('garde une liste et ses déploiements dans la même requête', () => {
    const lists = [list('list_a'), list('list_b')];
    const deployments = [deployment('depl_a1', 'list_a'), deployment('depl_b1', 'list_b'), deployment('depl_a2', 'list_a')];
    const batches = buildPushBatches('', lists, deployments, [], { records: 3, bytes: 5_000_000 });
    expect(batches).toHaveLength(2);
    expect(batches[0].lists.map((l) => l.id)).toEqual(['list_a']);
    expect(batches[0].deployments.map((d) => d.id)).toEqual(['depl_a1', 'depl_a2']);
    expect(batches[1].lists.map((l) => l.id)).toEqual(['list_b']);
  });

  it('respecte la borne de taille en octets', () => {
    const lists = [list('list_a'), list('list_b'), list('list_c')];
    const one = JSON.stringify({ lists: [toWireList(lists[0])], deployments: [], deletions: [] }).length;
    const batches = buildPushBatches('', lists, [], [], { records: 200, bytes: one * 2 + 10 });
    expect(batches.map((b) => b.lists.length)).toEqual([2, 1]);
  });

  it("ne produit aucune requête quand il n'y a rien à pousser", () => {
    expect(buildPushBatches('', [], [], [])).toEqual([]);
  });
});

describe('RT_68 — idempotence', () => {
  it('donne la même empreinte au même corps', () => {
    expect(fingerprint('{"a":1}')).toBe(fingerprint('{"a":1}'));
    expect(fingerprint('{"a":1}')).not.toBe(fingerprint('{"a":2}'));
  });

  it('produit un UUID v4', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
