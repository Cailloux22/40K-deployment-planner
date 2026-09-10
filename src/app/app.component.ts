import { Component, OnInit, inject } from '@angular/core';
import { App } from '@capacitor/app';

import { LibraryService } from './data/library.service';
import { SyncService } from './net/sync.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  private readonly library = inject(LibraryService);
  private readonly sync = inject(SyncService);

  ngOnInit(): void {
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
