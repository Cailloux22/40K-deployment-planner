import { NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ServiceWorkerModule } from '@angular/service-worker';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { authInterceptor } from './net/auth.interceptor';
import { isNativeApp } from './pwa/install-context';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    // RT_54: service worker du build de production seulement, jamais dans
    // l'APK — ses fichiers y sont déjà locaux, et un service worker y figerait
    // des versions en concurrence avec les mises à jour de l'application.
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode() && !isNativeApp(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Les référentiels statiques (RT_02, RT_12, RT_23) sont lus comme des
    // assets locaux ; RT_21 joint le jeton de session aux seuls appels du
    // backend de synchronisation.
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
