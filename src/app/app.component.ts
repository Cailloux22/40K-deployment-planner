import { ApplicationRef, Component, OnInit, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { first } from 'rxjs';

import { LibraryService } from './data/library.service';
import { registerIcons } from './icons';
import { SyncService } from './net/sync.service';
import { AppUpdateService } from './pwa/app-update.service';
import { BoardPrefetchService } from './pwa/board-prefetch.service';
import { InstallService } from './pwa/install.service';
import { StoragePersistenceService } from './pwa/storage-persistence.service';

// RT_54: icônes embarquées dans le bundle, disponibles hors-ligne.
registerIcons();

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly sync = inject(SyncService);
  private readonly appRef = inject(ApplicationRef);
  private readonly updates = inject(AppUpdateService);
  private readonly prefetch = inject(BoardPrefetchService);
  private readonly persistence = inject(StoragePersistenceService);

  constructor() {
    // RT_55: instancié avant tout écran, pour capturer `beforeinstallprompt`.
    inject(InstallService);
  }

  ngOnInit(): void {
    // RT_57: annonce des nouvelles versions (RG_43).
    this.updates.start();
    // RT_58: demande de stockage persistant en mode installé (RG_44).
    void this.persistence.init();
    // RT_56: téléchargement des plateaux une fois l'application stable, pour
    // ne pas concurrencer le premier affichage (RG_42).
    this.appRef.isStable.pipe(first((stable) => stable)).subscribe(() => {
      void this.prefetch.start();
    });

    // EX_05/RT_08: la bibliothèque locale est chargée au démarrage, avant
    // toute tentative de synchronisation — l'application est utilisable même
    // si le réseau est absent.
    void this.library.load();

    // RT_10: la synchronisation se déclenche au retour au premier plan de
    // l'application, jamais de façon bloquante pour l'interaction en cours
    // (RG_09). La reprise du réseau est gérée par ConnectivityService.
    void App.addListener('resume', () => this.sync.onAppResumed());

    // Équivalent web du retour au premier plan.
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (globalThis.document?.visibilityState === 'visible') this.sync.onAppResumed();
    });
  }
}
