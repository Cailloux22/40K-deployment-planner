// RT_12 / RT_27 / RG_23 — image affichée pour un plateau.
//
// Liste de test « reco » (export NewRecruit, disposition Reconnaissance).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

// RT_12: image attendue pour le plateau n°1 de Purge the Foe vs Reconnaissance,
// telle que publiée AUJOURD'HUI par gdmissions.app (version la plus à jour).
const EXPECTED_BOARD =
  'https://gdmissions.app/assets/11th/layouts/no-measurements/purge-the-foe-vs-reconnaissance-1.png';

/**
 * Compare, octet par octet, l'image réellement chargée par un `<img>` (URL
 * d'objet du cache RT_27 ou asset embarqué) à celle servie par gdmissions.app.
 */
function shouldDisplayExpectedBoard(img: string): void {
  cy.get(img)
    .should('be.visible')
    .and(($img) => {
      // L'image est résolue de façon asynchrone (pipe `boardImage | async`).
      expect($img.attr('src'), 'src du plateau').to.be.a('string').and.not.be.empty;
      expect(($img[0] as HTMLImageElement).naturalWidth, 'image décodée').to.be.greaterThan(0);
    })
    .then(($img) => {
      const src = ($img[0] as HTMLImageElement).currentSrc;
      // RT_27: en ligne, l'image vient du réseau (URL d'objet), pas de l'asset
      // embarqué — qui peut être identique et ne prouverait rien.
      expect(src, 'image obtenue depuis gdmissions.app').to.match(/^blob:/);
      cy.window()
        .then((win) => win.fetch(src).then((res) => res.arrayBuffer()))
        .then((displayed) => {
          cy.request({ url: EXPECTED_BOARD, encoding: 'binary' }).then(({ body }) => {
            const expected = Cypress.Buffer.from(body as string, 'binary');
            const actual = new Uint8Array(displayed);
            expect(actual.length, `taille de l'image affichée (${src})`).to.eq(expected.length);
            const firstDiff = actual.findIndex((byte, i) => byte !== expected[i]);
            expect(firstDiff, `premier octet différent de ${EXPECTED_BOARD}`).to.eq(-1);
          });
        });
    });
}

describe('Image du plateau', () => {
  beforeEach(() => {
    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();

    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'reco').click();

    // RG_03: disposition adverse, puis plateau n°1.
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    cy.location('pathname').should('match', /\/adversary\/purge-the-foe\/boards$/);
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.get('button.tab[aria-label^="Plateau 1"]').should('have.attr', 'aria-selected', 'true');
  });

  it('affiche le plateau n°1 de Purge the Foe au choix du plateau', () => {
    // RG_14: les plateaux sont rangés par numéro, le n°1 est la première page.
    shouldDisplayExpectedBoard('.slide:first-child button.preview img');
  });

  it("affiche le même plateau sur l'écran de placement", () => {
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/board\/purge-the-foe__reconnaissance__1\/placement$/);
    shouldDisplayExpectedBoard('img.board-image');
  });
});
