import { addIcons } from 'ionicons';
import {
  add,
  alertCircleOutline,
  cafeOutline,
  arrowBack,
  chevronBack,
  chevronForward,
  clipboard,
  clipboardOutline,
  close,
  cloudOfflineOutline,
  cloudUploadOutline,
  documentAttachOutline,
  documentTextOutline,
  downloadOutline,
  ellipsisVertical,
  expandOutline,
  folderOpenOutline,
  gitBranchOutline,
  handLeftOutline,
  helpCircleOutline,
  libraryOutline,
  linkOutline,
  logoGithub,
  menu,
  personCircleOutline,
  radioButtonOnOutline,
  settingsOutline,
  shareOutline,
  shareSocialOutline,
  syncOutline,
  trashOutline,
} from 'ionicons/icons';

/**
 * RT_54 — icônes Ionicons enregistrées dans le bundle.
 *
 * Le dossier `svg/` d'Ionicons (environ 1 350 fichiers) n'est pas mis en cache
 * par le service worker : une icône chargée par le réseau manquerait hors-ligne
 * si elle n'avait jamais été affichée en ligne. Toute icône employée par un
 * `<ion-icon name="…">` doit donc figurer ici.
 */
export function registerIcons(): void {
  addIcons({
    add,
    'alert-circle-outline': alertCircleOutline,
    'arrow-back': arrowBack,
    // RG_68/RT_88: entrée « Buy us a coffee » du bloc « Aide » des Réglages.
    'cafe-outline': cafeOutline,
    'chevron-back': chevronBack,
    'chevron-forward': chevronForward,
    // RT_61/RT_62: note de plan de jeu — contour sans note, plein avec note.
    clipboard,
    'clipboard-outline': clipboardOutline,
    close,
    'cloud-offline-outline': cloudOfflineOutline,
    'cloud-upload-outline': cloudUploadOutline,
    'document-attach-outline': documentAttachOutline,
    // RT_66: bouton « Missions » (choix du plateau, placement, « Consulter »).
    'document-text-outline': documentTextOutline,
    'download-outline': downloadOutline,
    'ellipsis-vertical': ellipsisVertical,
    'expand-outline': expandOutline,
    'folder-open-outline': folderOpenOutline,
    'git-branch-outline': gitBranchOutline,
    'hand-left-outline': handLeftOutline,
    // RG_62/RT_86: bouton « Visite guidée » du bloc « Aide » des Réglages.
    'help-circle-outline': helpCircleOutline,
    'library-outline': libraryOutline,
    'link-outline': linkOutline,
    // RG_67/RT_87: entrée « Code source » du bloc « Aide » des Réglages.
    'logo-github': logoGithub,
    menu,
    'person-circle-outline': personCircleOutline,
    // RG_60/RT_81: bouton « Portée » de l'écran de placement (cercle et point central).
    'radio-button-on-outline': radioButtonOnOutline,
    'settings-outline': settingsOutline,
    'share-outline': shareOutline,
    // RT_75: partage du déploiement en image dans le visualiseur « Consulter ».
    'share-social-outline': shareSocialOutline,
    // RG_48/RT_66: retourner une carte de mission (recto/verso).
    'sync-outline': syncOutline,
    'trash-outline': trashOutline,
  });
}
