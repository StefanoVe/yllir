import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    // Documents have paths with slashes (`doc/characters/alia.md`): the reader reads the remaining URL.
    path: 'doc',
    children: [
      {
        path: '**',
        loadComponent: () => import('./reader/reader').then((m) => m.Reader),
      },
    ],
  },
  {
    path: 'search',
    loadComponent: () => import('./search/search').then((m) => m.Search),
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings').then((m) => m.Settings),
  },
  {
    path: 'live',
    loadComponent: () => import('./cockpit/cockpit').then((m) => m.Cockpit),
  },
  {
    path: 'plot',
    loadComponent: () => import('./plot/plot-map').then((m) => m.PlotMapComponent),
  },
  {
    path: 'music',
    loadComponent: () => import('./music/music-library').then((m) => m.MusicLibrary),
  },
  {
    path: 'encyclopedia',
    loadComponent: () => import('./encyclopedia/encyclopedia').then((m) => m.EncyclopediaPage),
  },
  {
    path: 'print',
    loadComponent: () => import('./print/print').then((m) => m.PrintPage),
  },
  { path: '**', redirectTo: '' },
];
