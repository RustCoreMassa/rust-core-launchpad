import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { WalletStore } from '../../core/wallet/wallet-store';

/**
 * /admin opens only for the connected admin wallet (or the one offered the role, to accept it).
 * Anyone else — or no wallet — lands on the home page; the contract refuses their calls anyway.
 */
export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const reader = inject(LaunchpadReader);
  try {
    if (await reader.isAdminOrOffered(inject(WalletStore).address())) return true;
  } catch {
    // Can't tell (RPC down): don't open it.
  }
  return router.parseUrl('/');
};
