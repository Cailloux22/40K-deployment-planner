import { addIcons } from 'ionicons';
import {
  add,
  alertCircleOutline,
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
  libraryOutline,
  linkOutline,
  menu,
  personCircleOutline,
  returnUpBack,
  returnUpForward,
  saveOutline,
  settingsOutline,
  shareOutline,
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
    'library-outline': libraryOutline,
    'link-outline': linkOutline,
    menu,
    'person-circle-outline': personCircleOutline,
    'return-up-back': returnUpBack,
    'return-up-forward': returnUpForward,
    'save-outline': saveOutline,
    'settings-outline': settingsOutline,
    'share-outline': shareOutline,
    'trash-outline': trashOutline,
  });
}
