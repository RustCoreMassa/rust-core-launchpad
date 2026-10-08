import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <a class="brand" routerLink="/">
            <img class="brand-logo" src="assets/logo-light.png" alt="" width="40" height="34" />
            <span>RustCore Launchpad</span>
          </a>
          <p>Launch tokens and NFTs on Massa. No backend — everything lives on-chain.</p>
        </div>
        <div class="footer-cols">
          <div>
            <h4>Launchpad</h4>
            <a routerLink="/tokens">Tokens</a>
            <a routerLink="/collections">Collections</a>
            <a routerLink="/marketplace">Marketplace</a>
            <a routerLink="/presales">Presales</a>
          </div>
          <div>
            <h4>RustCore</h4>
            <a href="https://rustcore.massa.network">rustcore.massa</a>
            <a href="https://wrustcore.massa.network">RustCore Wallet</a>
            <a href="https://github.com/RustCoreMassa">GitHub</a>
            <a href="https://t.me/rustcore_massa">Telegram</a>
          </div>
          <div>
            <h4>Massa</h4>
            <a href="https://massa.net">massa.net</a>
            <a href="https://docs.massa.net/docs/deweb/home">DeWeb</a>
            <a href="https://explorer.massa.net">Explorer</a>
          </div>
        </div>
      </div>
      <div class="container footer-bottom">
        <span>© 2026 RustCore</span>
        <span>Not affiliated with Massa Labs.</span>
      </div>
    </footer>
  `,
  styles: `
    .site-footer {
      border-top: 1px solid var(--border);
      padding: 56px 0 32px;
      background: rgba(7, 7, 10, 0.6);
    }

    .footer-inner {
      display: grid;
      grid-template-columns: 1fr 1.4fr;
      gap: 40px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      font: 700 18px/1 var(--font-display);
    }

    .brand-logo {
      height: 34px;
      width: auto;
    }

    .footer-brand p {
      margin: 14px 0 0;
      max-width: 300px;
      color: var(--gray-500);
      font-size: 14px;
    }

    .footer-cols {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
    }

    h4 {
      margin-bottom: 12px;
      font-size: 14px;
    }

    .footer-cols a {
      display: block;
      padding: 4px 0;
      color: var(--gray-500);
      font-size: 14px;
      text-decoration: none;
    }

    .footer-cols a:hover {
      color: var(--white);
    }

    .footer-bottom {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--gray-700);
      font-size: 13px;
    }

    @media (max-width: 900px) {
      .footer-inner {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .footer-cols {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class SiteFooter {}
