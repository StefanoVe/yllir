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
  { path: '**', redirectTo: '' },
];
