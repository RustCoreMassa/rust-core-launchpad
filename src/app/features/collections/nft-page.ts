import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CollectionReader } from '../../core/launchpad/collection-reader';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { NftMetadata, NftMetadataLoader } from '../../core/launchpad/nft-metadata';
import { KIND_COLLECTION, Project } from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { httpUrl } from '../../core/utils/ipfs';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';

/** One NFT: its metadata (from the creator's link), its holder and its collection. */
@Component({
  selector: 'app-nft-page',
  imports: [RouterLink, ShortAddressPipe, ProjectBadges],
  template: `
    <section class="page container">
      <a class="back muted" [routerLink]="['/collections', address()]"
        >← {{ project()?.name || 'Collection' }}</a
      >
      @if (error(); as message) {
        <div class="notice notice-error" role="alert">{{ message }}</div>
      }
      @if (owner() === undefined) {
        <div class="layout">
          <span class="skeleton art"></span>
          <span class="skeleton" style="width: 50%; height: 32px"></span>
        </div>
      } @else if (owner() === '') {
        <div class="card">
          <h1>NFT not found</h1>
          <p class="muted">
            #{{ tokenId() }} doesn't exist in this collection (not minted, or burned).
          </p>
        </div>
      } @else {
        <div class="layout">
          <div class="art card">
            @if (meta()?.image) {
              <img [src]="meta()!.image" alt="" referrerpolicy="no-referrer" />
            } @else {
              <span class="placeholder">#{{ tokenId() }}</span>
            }
          </div>
          <div class="details">
            @if (project(); as p) {
              <span class="label">{{ p.name }}</span>
            }
            <h1>{{ meta()?.name || '#' + tokenId() }}</h1>
            @if (project(); as p) {
              <app-project-badges [project]="p" />
            }
            @if (meta()?.description; as description) {
              <p class="description">{{ description }}</p>
            }
            <div class="card">
              <dl class="rows">
                <div>
                  <dt>Owner</dt>
                  <dd class="mono">
                    {{ owner() | shortAddress }}
                    @if (owner() === wallet.address()) {
                      <span class="yours">· you</span>
                    }
                  </dd>
                </div>
                <div>
                  <dt>Token id</dt>
                  <dd>{{ tokenId() }}</dd>
                </div>
                @if (uri()) {
                  <div>
                    <dt>Metadata</dt>
                    <dd>
                      @if (uriLink()) {
                        <a [href]="uriLink()" target="_blank" rel="noopener noreferrer"
                          >Open JSON</a
                        >
                      } @else {
                        <span class="mono">{{ uri() }}</span>
                      }
                    </dd>
                  </div>
                }
              </dl>
            </div>
            @if (meta()?.attributes?.length) {
              <h2>Attributes</h2>
              <div class="attributes">
                @for (a of meta()!.attributes; track a.trait) {
                  <div class="attribute">
                    <span class="muted">{{ a.trait }}</span>
                    <strong>{{ a.value }}</strong>
                  </div>
                }
              </div>
            } @else if (meta() === null) {
              <p class="muted">The metadata couldn't be loaded from the creator's link.</p>
            }
            <p class="hint">Buying and selling arrive with the marketplace (phase 5).</p>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .back {
      display: inline-block;
      margin-bottom: 16px;
      font-size: 14px;
      text-decoration: none;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 28px;
      align-items: start;
    }

    .art {
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      overflow: hidden;
      padding: 0;
    }

    .art img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .placeholder {
      color: var(--gray-500);
      font: 700 40px/1 var(--font-display);
    }

    .details {
      display: grid;
      gap: 14px;
    }

    h1 {
      font-size: clamp(28px, 4vw, 40px);
      overflow-wrap: anywhere;
    }

    h2 {
      font-size: 18px;
    }

    .description {
      margin: 0;
      color: var(--gray-300);
      white-space: pre-line;
    }

    .yours {
      color: #7ee2a8;
    }

    .attributes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
    }

    .attribute {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-strong);
      background: rgba(255, 255, 255, 0.03);
      font-size: 13px;
    }

    .attribute strong {
      font-size: 15px;
      overflow-wrap: anywhere;
    }

    @media (max-width: 860px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NftPage {
  private readonly launchpad = inject(LaunchpadReader);
  private readonly collections = inject(CollectionReader);
  private readonly loader = inject(NftMetadataLoader);
  private readonly networks = inject(NetworkStore);
  protected readonly wallet = inject(WalletStore);

  /** Route parameters. */
  readonly address = input.required<string>();
  readonly tokenId = input.required<string>();

  protected readonly project = signal<Project | null>(null);
  /** undefined = loading, '' = no such NFT. */
  protected readonly owner = signal<string | undefined>(undefined);
  protected readonly uri = signal('');
  /** undefined = loading, null = unusable. */
  protected readonly meta = signal<NftMetadata | null | undefined>(undefined);
  protected readonly error = signal<string | null>(null);
  protected readonly uriLink = computed(() => httpUrl(this.uri()));
  private run = 0;

  constructor() {
    effect(() => {
      const address = this.address();
      const tokenId = this.tokenId();
      this.networks.network();
      untracked(() => void this.load(address, tokenId));
    });
  }

  private async load(address: string, tokenId: string): Promise<void> {
    const run = ++this.run;
    this.owner.set(undefined);
    this.meta.set(undefined);
    this.uri.set('');
    this.error.set(null);
    if (!/^\d{1,77}$/.test(tokenId)) {
      this.owner.set('');
      return;
    }
    const id = BigInt(tokenId);
    try {
      if (this.launchpad.address()) {
        const project = await this.launchpad.projectByAddress(address);
        if (run !== this.run) return;
        this.project.set(project?.kind === KIND_COLLECTION ? project : null);
      }
      const owner = await this.collections.ownerOf(address, id).catch(() => '');
      if (run !== this.run) return;
      this.owner.set(owner);
      if (!owner) return;
      const uri = await this.collections.uri(address, id);
      if (run !== this.run) return;
      this.uri.set(uri);
      const meta = await this.loader.load(uri);
      if (run === this.run) this.meta.set(meta);
    } catch (err) {
      if (run !== this.run) return;
      this.error.set(toUserMessage(err));
      this.meta.set(null);
    }
  }
}
