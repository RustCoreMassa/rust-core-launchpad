import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { WalletStore } from '../../core/wallet/wallet-store';
import { adminGuard } from './admin-guard';

function run(address: string | null, allowed: boolean | Error) {
  const isAdminOrOffered = vi.fn(async () => {
    if (allowed instanceof Error) throw allowed;
    return allowed;
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: LaunchpadReader, useValue: { isAdminOrOffered } },
      { provide: WalletStore, useValue: { address: () => address } },
    ],
  });
  const result = TestBed.runInInjectionContext(() =>
    adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;
  return { result, isAdminOrOffered };
}

describe('adminGuard', () => {
  it('lets the admin (or the offered admin) in', async () => {
    const { result, isAdminOrOffered } = run('AU1admin', true);
    expect(await result).toBe(true);
    expect(isAdminOrOffered).toHaveBeenCalledWith('AU1admin');
  });

  it('sends any other wallet home', async () => {
    const { result } = run('AU1someone', false);
    const tree = await result;
    expect(tree).toBeInstanceOf(UrlTree);
    expect(String(tree)).toBe(String(TestBed.inject(Router).parseUrl('/')));
  });

  it('sends home when no wallet is connected or the check fails', async () => {
    expect(String(await run(null, false).result)).toBe('/');
    TestBed.resetTestingModule();
    expect(String(await run('AU1admin', new Error('RPC down')).result)).toBe('/');
  });
});
