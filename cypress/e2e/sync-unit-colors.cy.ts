// RT_76 — non-régression d'un défaut de synchronisation (RG_06/RT_68/RT_69).
//
// Au-delà de la 16e unité d'une liste, `autoUnitColor` sortait de la palette
// en produisant une couleur `hsl(…)`. Le contrat (openapi.yml,
// `ArmyUnit.color`) n'accepte que `#RRGGBB` : le serveur rejetait la liste
// (INVALID_RECORD sur `units[16].color`), puis chacun de ses déploiements,
// dont la liste n'existait alors pas sur le compte (UNKNOWN_LIST).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';
const USER = { id: 'cypress-user', email: 'cypress@example.test' };
const EMPTY_PULL = {
  lists: [],
  deployments: [],
  deletedListIds: [],
  deletedDeploymentIds: [],
  nextToken: 'rev-1',
  hasMore: false,
};
// Motif de `ArmyUnit.color` dans specification/openapi.yml.
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

interface PushedUnit {
  readonly color: string;
}
interface PushedList {
  readonly id: string;
  readonly units: readonly PushedUnit[];
}
interface PushedDeployment {
  readonly id: string;
  readonly listId: string;
}
interface PushBody {
  readonly lists: readonly PushedList[];
  readonly deployments: readonly PushedDeployment[];
}

/**
 * Serveur de synchronisation simulé qui applique les deux règles en cause,
 * avec ses messages réels (Windfall-Planner-api, `push-operations.ts` et
 * `sync.ts`) : validation du motif de couleur, puis rejet d'un déploiement
 * dont la liste n'a été ni connue du compte ni acceptée dans la poussée.
 */
function pushReply(body: PushBody) {
  let revision = 1;
  const accepted: { resourceType: string; id: string; deleted: boolean; versionToken: string }[] = [];
  const rejected: { resourceType: string; id: string; code: string; message: string }[] = [];
  const acceptedLists = new Set<string>();

  for (const list of body.lists) {
    const index = list.units.findIndex((unit) => !COLOR_PATTERN.test(unit.color));
    if (index >= 0) {
      rejected.push({
        resourceType: 'list',
        id: list.id,
        code: 'INVALID_RECORD',
        message:
          `Enregistrement non conforme (units[${index}].color) : ` +
          'Chaîne de caractère invalide : doit correspondre au motif /^#[0-9A-Fa-f]{6}$/',
      });
    } else {
      acceptedLists.add(list.id);
      accepted.push({ resourceType: 'list', id: list.id, deleted: false, versionToken: String(++revision) });
    }
  }
  for (const deployment of body.deployments) {
    if (acceptedLists.has(deployment.listId)) {
      accepted.push({ resourceType: 'deployment', id: deployment.id, deleted: false, versionToken: String(++revision) });
    } else {
      rejected.push({
        resourceType: 'deployment',
        id: deployment.id,
        code: 'UNKNOWN_LIST',
        message: 'La liste de ce déploiement n’existe pas sur le compte.',
      });
    }
  }
  return { accepted, conflicts: [], rejected };
}

describe('Synchronisation d’une liste de plus de 16 unités', () => {
  let pushes: PushBody[] = [];

  beforeEach(() => {
    pushes = [];
    cy.intercept('GET', '**/v1/sync/changes*', EMPTY_PULL).as('pull');
    cy.intercept('POST', '**/v1/sync/changes', (req) => {
      const body = req.body as PushBody;
      pushes.push(body);
      req.reply(pushReply(body));
    }).as('push');

    // Liste de plus de 16 unités : Reconnaissance + deux copies de son
    // Skorpius Dunerider, sous d'autres identifiants de sélection.
    cy.readFile(RECO_LIST).then((source) => {
      const roster = structuredClone(source);
      const selections = roster.roster.forces[0].selections;
      const original = selections.find((s: { name: string }) => s.name === 'Skorpius Dunerider');
      for (const suffix of ['copie-1', 'copie-2']) {
        selections.push({ ...structuredClone(original), id: `${original.id}-${suffix}`, incomingAssociations: [] });
      }

      cy.visitFresh('/import');
      cy.get('input[type="file"]').selectFile(
        { contents: Cypress.Buffer.from(JSON.stringify(roster)), fileName: 'reco-17-unites.json' },
        { force: true },
      );
    });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');

    // Un déploiement de cette liste, enregistré avant toute connexion.
    cy.contains('.list-card', 'reco').click();
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);
    cy.get('button[aria-label="Revenir au choix du plateau"]').click();
    cy.location('pathname').should('match', /\/boards$/);

    // Appareil déjà rattaché au compte (RG_51) : la passe va directement au
    // pull puis à la poussée de la liste et de son déploiement.
    cy.window().then((win) => {
      win.localStorage.setItem('wfp.auth.session', JSON.stringify({ deviceToken: 'cypress-token', user: USER }));
      win.localStorage.setItem('wfp.sync.accountId', JSON.stringify(USER.id));
    });
    cy.visit('/settings');
    cy.get('ion-app').should('have.class', 'hydrated');
    cy.wait('@push');
  });

  // RG_06/RT_69: la couleur de chaque unité poussée respecte le contrat.
  it('ne pousse que des couleurs d’unité au format #RRGGBB', () => {
    cy.then(() => {
      const list = pushes.flatMap((p) => p.lists)[0];
      expect(list.units.length, 'nombre d’unités').to.be.greaterThan(16);
      list.units.forEach((unit, index) => {
        expect(unit.color, `units[${index}].color`).to.match(COLOR_PATTERN);
      });
    });
  });

  // RG_19: ni la liste ni son déploiement ne sont refusés par le serveur.
  it('ne signale aucun refus de la liste ni de son déploiement', () => {
    cy.then(() => expect(pushes.flatMap((p) => p.deployments)).to.have.length(1));
    cy.contains('ion-note', 'refusé').should('not.exist');
    cy.contains('p', 'Liste refusé').should('not.exist');
    cy.contains('p', 'Déploiement refusé').should('not.exist');
  });
});
