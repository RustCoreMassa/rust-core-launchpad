import { Routes } from '@angular/router';
import type { PlannedPageData } from './shared/ui/planned-page/planned-page';

const planned = () => import('./shared/ui/planned-page/planned-page').then((m) => m.PlannedPage);

/** A page that arrives in a later phase (docs/ANALYSIS.md, "Plan de dezvoltare"). */
function plannedRoute(path: string, title: string, data: PlannedPageData) {
  return { path, title: `${title} · RustCore Launchpad`, loadComponent: planned, data };
}

export const routes: Routes = [
  {
    path: '',
    title: 'RustCore Launchpad — Launch tokens and NFTs on Massa',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'tokens',
    title: 'Tokens · RustCore Launchpad',
    loadComponent: () => import('./features/explore/explore-page').then((m) => m.ExplorePage),
    data: { kind: 0 },
  },
  {
    path: 'tokens/:address',
    title: 'Token · RustCore Launchpad',
    loadComponent: () => import('./features/tokens/token-page').then((m) => m.TokenPage),
  },
  {
    path: 'collections',
    title: 'Collections · RustCore Launchpad',
    loadComponent: () => import('./features/explore/explore-page').then((m) => m.ExplorePage),
    data: { kind: 1 },
  },
  {
    path: 'collections/:address',
    title: 'Collection · RustCore Launchpad',
    loadComponent: () =>
      import('./features/collections/collection-page').then((m) => m.CollectionPage),
  },
  {
    path: 'collections/:address/:tokenId',
    title: 'NFT · RustCore Launchpad',
    loadComponent: () => import('./features/collections/nft-page').then((m) => m.NftPage),
  },
  {
    path: 'marketplace',
    title: 'Marketplace · RustCore Launchpad',
    loadComponent: () =>
      import('./features/marketplace/marketplace-page').then((m) => m.MarketplacePage),
  },
  plannedRoute('presales', 'Presales', {
    label: 'Presales',
    heading: 'Token presales',
    text: 'Contribute MAS to upcoming tokens; claim your tokens on success, or get refunded.',
    phase: 6,
  }),
  plannedRoute('presales/:id', 'Presale', {
    label: 'Presales',
    heading: 'Presale',
    text: 'Progress, terms, your contribution, claim and refund.',
    phase: 6,
  }),
  {
    path: 'create/token',
    title: 'Create a token · RustCore Launchpad',
    loadComponent: () =>
      import('./features/create/create-token-page').then((m) => m.CreateTokenPage),
  },
  {
    path: 'create/collection',
    title: 'Create a collection · RustCore Launchpad',
    loadComponent: () =>
      import('./features/create/create-collection-page').then((m) => m.CreateCollectionPage),
  },
  plannedRoute('create/presale/:token', 'Create a presale', {
    label: 'Create',
    heading: 'Start a presale',
    text: 'Rate, caps, limits and dates for a token you own.',
    phase: 6,
  }),
  {
    path: 'me',
    title: 'My launches · RustCore Launchpad',
    loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  plannedRoute('admin', 'Admin', {
    label: 'Admin',
    heading: 'Administration',
    text: 'Fees, templates, verification and the upgrade timelock — for the Launchpad admin only.',
    phase: 7,
  }),
  {
    path: '**',
    title: 'Page not found · RustCore Launchpad',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
