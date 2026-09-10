import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';
import { LibraryService } from './data/library.service';
import { SyncService } from './net/sync.service';

describe('AppComponent', () => {
  let load: ReturnType<typeof vi.fn>;
  let onAppResumed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    load = vi.fn().mockResolvedValue(undefined);
    onAppResumed = vi.fn();

    await TestBed.configureTestingModule({
      declarations: [AppComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: LibraryService, useValue: { load } },
        { provide: SyncService, useValue: { onAppResumed } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('EX_05/RT_08 : charge la bibliothèque locale au démarrage', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.componentInstance.ngOnInit();
    expect(load).toHaveBeenCalled();
  });

  it('RT_10 : le retour au premier plan déclenche une synchronisation', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.componentInstance.ngOnInit();
    document.dispatchEvent(new Event('visibilitychange'));
    // jsdom rapporte `visibilityState === 'visible'` par défaut.
    expect(onAppResumed).toHaveBeenCalled();
  });
});
