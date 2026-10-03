import { defineConfig } from 'cypress';

/**
 * Serveurs de développement possibles, dans l'ordre d'essai :
 * - `ionic serve` (avec ou sans `--external`) écoute sur 8100 ;
 * - `ng serve` / `npm start` (et donc `npm run e2e`) écoute sur 4200.
 * Une URL explicite (`--config baseUrl=…` ou `CYPRESS_BASE_URL`) reste prioritaire.
 */
const DEV_SERVERS = ['http://localhost:8100', 'http://localhost:4200'];

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export default defineConfig({
  e2e: {
    // Pas de baseUrl ici : elle est choisie dans `setupNodeEvents`, ce qui
    // distingue une valeur passée explicitement de la valeur par défaut.
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    // Application mobile-first : viewport d'un téléphone par défaut.
    viewportWidth: 390,
    viewportHeight: 844,
    // Les composants Ionic (ion-button…) portent leur élément natif et ses
    // attributs ARIA dans leur shadow DOM.
    includeShadowDom: true,
    video: false,
    screenshotOnRunFailure: true,
    async setupNodeEvents(_on, config) {
      // Une baseUrl passée explicitement n'est jamais remplacée.
      if (config.baseUrl) return config;
      for (const url of DEV_SERVERS) {
        if (await isUp(url)) return { ...config, baseUrl: url };
      }
      // Aucun serveur démarré : Cypress signalera l'URL attendue par défaut.
      return { ...config, baseUrl: DEV_SERVERS[DEV_SERVERS.length - 1] };
    },
  },
});
