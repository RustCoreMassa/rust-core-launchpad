import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly features = [
    {
      path: '/create/token',
      title: 'Launch a token',
      text: 'An MRC20 token in one transaction. You own the contract and the whole supply.',
    },
    {
      path: '/create/collection',
      title: 'Launch an NFT collection',
      text: 'An MRC721 collection with owner or public mint, royalty and IPFS metadata.',
    },
    {
      path: '/marketplace',
      title: 'Trade NFTs',
      text: 'List and buy without custody. A small marketplace fee and the creator’s royalty, nothing else.',
    },
    {
      path: '/presales',
      title: 'Run a presale',
      text: 'Raise MAS for your token. Contributors claim tokens on success or get refunded.',
    },
  ] as const;

  protected readonly steps = [
    {
      title: 'Fill in the details',
      text: 'Name, symbol, supply, links — and whether the code may change later.',
    },
    {
      title: 'Sign once',
      text: 'Your wallet signs one transaction; the Launchpad contract deploys from audited templates.',
    },
    {
      title: 'Own it',
      text: 'You are the owner from the first block. Download the original code anytime.',
    },
  ] as const;
}
