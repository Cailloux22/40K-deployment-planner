// RT_63: package.json est l'unique source du numéro de version ; seul le champ
// `version` est importé, les autres champs ne sont pas embarqués dans le bundle.
import { version } from '../../package.json';

/** RG_47: numéro de version affiché dans les Réglages. */
export const APP_VERSION: string = version;
