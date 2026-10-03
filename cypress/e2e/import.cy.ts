// Liste d'exemple versionnée dans le dépôt (export NewRecruit, Adeptus Mechanicus).
const EXAMPLE_LIST = 'src/assets/list_import.example.json';

describe("Import d'une liste", () => {
  beforeEach(() => {
    cy.visitFresh('/import');
  });

  function chooseExampleFile(): void {
    // Le contrôle natif est escamoté visuellement (RT_31) : `force` contourne
    // la vérification de visibilité, le fichier passe par le vrai `change`.
    cy.get('input[type="file"]').selectFile(EXAMPLE_LIST, { force: true });
  }

  // RG_22: récapitulatif avant enregistrement.
  it('affiche le récapitulatif de la liste choisie', () => {
    chooseExampleFile();

    cy.get('ion-input[label="Nom de la liste"]').should('have.prop', 'value', 'breachers protector');
    // RT_23: disposition extraite de l'import.
    cy.contains('.disposition h2', 'Priority Assets').should('be.visible');
    cy.get('.counts').within(() => {
      cy.contains('div', 'unités').find('strong').should('have.text', '14');
      cy.contains('div', 'modèles').find('strong').should('have.text', '56');
      // RG_02: tous les socles sont reconnus par le référentiel.
      cy.contains('div', 'socles à assigner').find('strong').should('have.text', '0');
    });
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').should('not.have.attr', 'disabled');
  });

  it('enregistre la liste sous le nom choisi et la retrouve dans la bibliothèque', () => {
    chooseExampleFile();

    cy.get('ion-input[label="Nom de la liste"] input').clear().type('Mechanicus — test e2e');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();

    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'Mechanicus — test e2e')
      .should('be.visible')
      .and('contain.text', 'Priority Assets')
      .and('contain.text', '14 unités')
      .and('contain.text', '56 modèles')
      .and('contain.text', 'Aucun déploiement enregistré');
  });

  // RG_22: annuler demande confirmation, puis n'enregistre rien.
  it("n'enregistre rien quand le joueur abandonne l'import", () => {
    chooseExampleFile();
    cy.get('.summary').should('be.visible');

    cy.contains('ion-footer ion-button', 'Annuler').click();
    cy.contains('ion-alert', 'Abandonner cet import ?').should('be.visible');
    cy.contains('ion-alert button', 'Abandonner').click();

    cy.location('pathname').should('eq', '/home');
    cy.contains('h2', 'Aucune liste importée').should('be.visible');
  });

  it("conserve le récapitulatif quand le joueur poursuit l'import", () => {
    chooseExampleFile();
    cy.get('.summary').should('be.visible');

    cy.contains('ion-footer ion-button', 'Annuler').click();
    cy.contains('ion-alert button', 'Continuer l’import').click();

    cy.get('ion-alert').should('not.exist');
    cy.location('pathname').should('eq', '/import');
    cy.get('.summary').should('be.visible');
  });

  // RG_01: un fichier illisible est rejeté explicitement.
  it('refuse un fichier qui n’est pas une liste', () => {
    cy.get('input[type="file"]').selectFile(
      { contents: Cypress.Buffer.from('{"pas":"une liste"}'), fileName: 'invalide.json' },
      { force: true },
    );

    cy.contains('ion-card-title', 'Import refusé').should('be.visible');
    cy.get('.summary').should('not.exist');
  });
});
