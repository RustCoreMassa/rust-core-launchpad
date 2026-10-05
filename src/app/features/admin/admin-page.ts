import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Args } from '@massalabs/massa-web3';
import { symbolError } from '../../core/launchpad/launch-rules';
import { LaunchpadReader, SymbolStatus } from '../../core/launchpad/launchpad-reader';
import { timeLeft } from '../../core/launchpad/presale-state';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  KIND_COLLECTION,
  KIND_TOKEN,
  LaunchpadConfig,
  Project,
  ProjectKind,
  SOURCE_IMPORTED,
  UpgradeProposal,
  hex,
  writeConfig,
} from '../../core/launchpad/records';
import { KNOWN_TEMPLATES } from '../../core/launchpad/templates';
import { Transactions } from '../../core/launchpad/transactions';
import { NetworkStore } from '../../core/network/network-store';
import { sha256 } from '../../core/utils/sha256';
import { toUserMessage } from '../../core/utils/user-error';
import { WalletStore } from '../../core/wallet/wallet-store';
import { ConnectWalletDialog } from '../../layout/connect-wallet-dialog/connect-wallet-dialog';
import { ShortAddressPipe } from '../../shared/pipes/short-address-pipe';
import { MasPipe } from '../../shared/pipes/units-pipe';
import { priceNano } from '../create/collection-draft';
import {
  ADDRESS,
  ADMIN_COINS,
  FeeErrors,
  FeeForm,
  configFromForm,
  feeFormOf,
  isWasm,
  masText,
  templateCoins,
  upgradeCoins,
} from './admin-forms';

interface TemplateState {
  kind: ProjectKind;
  label: string;
  version: number;
  hash: string;
  known: boolean;
}

interface Status {
  version: string;
  admin: string;
  pendingAdmin: string | null;
  balance: bigint;
  fees: bigint;
  config: LaunchpadConfig;
  upgrade: UpgradeProposal | null;
  templates: TemplateState[];
}

/** A .wasm picked from disk, with what the page shows about it. */
interface PickedCode {
  name: string;
  bytes: Uint8Array;
  hash: string;
}

const TEMPLATE_LABELS = ['RC-Token', 'RC-Collection'];
/** Most projects the moderation search shows at once. */
const MAX_RESULTS = 20;

/**
 * The Launchpad admin's tools: pause, fees, fee withdrawal, verified / hidden, reserved
 * symbols, templates, the upgrade timelock and the admin handover. The status (and a pending
 * upgrade) is public: anyone can open this page and see it, only the admin wallet can act.
 */
@Component({
  selector: 'app-admin-page',
  imports: [DatePipe, RouterLink, MasPipe, ShortAddressPipe, ConnectWalletDialog],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);
  protected readonly wallet = inject(WalletStore);
  private readonly transactions = inject(Transactions);
  private readonly store = inject(ProjectStore);

  /** undefined while loading. */
  protected readonly status = signal<Status | undefined>(undefined);
  protected readonly loadError = signal<string | null>(null);
  /** The action waiting for the wallet; one at a time. */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<{ section: string; message: string } | null>(null);
  protected readonly done = signal<{ section: string; message: string } | null>(null);
  protected readonly now = signal(Date.now());

  protected readonly isAdmin = computed(
    () => !!this.wallet.address() && this.wallet.address() === this.status()?.admin,
  );
  protected readonly isPendingAdmin = computed(
    () => !!this.wallet.address() && this.wallet.address() === this.status()?.pendingAdmin,
  );

  // ---- fees ----
  protected readonly feeForm = signal<FeeForm | null>(null);
  protected readonly feeErrors = computed<FeeErrors>(() => {
    const form = this.feeForm();
    const status = this.status();
    if (!form || !status) return {};
    const result = configFromForm(form, status.config.paused);
    return 'errors' in result ? result.errors : {};
  });
  protected readonly feeInvalid = computed(() => Object.keys(this.feeErrors()).length > 0);

  // ---- fee withdrawal ----
  protected readonly withdrawTo = signal('');
  protected readonly withdrawAmount = signal('');
  protected readonly withdrawNano = computed(() =>
    this.withdrawAmount() === '' ? null : priceNano(this.withdrawAmount()),
  );
  protected readonly withdrawError = computed(() => {
    const fees = this.status()?.fees ?? 0n;
    const amount = this.withdrawNano();
    if (this.withdrawTo() && !ADDRESS.test(this.withdrawTo())) return 'That address is not valid.';
    if (this.withdrawAmount() === '') return null;
    if (amount === null || amount === 0n) return 'Enter an amount in MAS.';
    if (amount > fees) return 'More than the fees collected.';
    return null;
  });

  // ---- moderation ----
  protected readonly query = signal('');
  private readonly tokens = this.store.list(KIND_TOKEN);
  private readonly collections = this.store.list(KIND_COLLECTION);
  protected readonly projectsLoading = computed(
    () => !this.tokens().loaded || !this.collections().loaded,
  );
  protected readonly results = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = [...this.tokens().projects, ...this.collections().projects];
    const matches = q
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.symbol.toLowerCase().includes(q) ||
            p.address.toLowerCase() === q ||
            p.creator.toLowerCase() === q,
        )
      : all.filter((p) => p.hidden || p.verified);
    return { total: matches.length, shown: matches.slice(0, MAX_RESULTS) };
  });
  protected readonly imported = SOURCE_IMPORTED;

  // ---- symbols ----
  protected readonly symbol = signal('');
  protected readonly symbolStatus = signal<SymbolStatus | null>(null);
  protected readonly symbolInvalid = computed(() =>
    this.symbol() ? symbolError(this.symbol()) : null,
  );

  // ---- templates ----
  protected readonly templateKind = signal<ProjectKind>(KIND_TOKEN);
  protected readonly templateCode = signal<PickedCode | null>(null);
  protected readonly templateTarget = computed(() => {
    const status = this.status();
    const code = this.templateCode();
    if (!status || !code) return null;
    const kind = this.templateKind();
    const next = status.templates[kind].version + 1;
    return { next, known: KNOWN_TEMPLATES[kind][next] === code.hash };
  });

  // ---- upgrade ----
  protected readonly upgradeCode = signal<PickedCode | null>(null);
  protected readonly upgradeMatches = computed(() => {
    const upgrade = this.status()?.upgrade;
    const code = this.upgradeCode();
    return !!upgrade && !!code && hex(upgrade.codeHash) === code.hash;
  });
  protected readonly upgradeReady = computed(() => {
    const upgrade = this.status()?.upgrade;
    return !!upgrade && this.now() >= upgrade.executableAt;
  });

  // ---- admin handover ----
  protected readonly newAdmin = signal('');
  protected readonly adminAddressValid = computed(
    () => ADDRESS.test(this.newAdmin()) && this.newAdmin() !== this.status()?.admin,
  );

  protected readonly hex = hex;

  private readonly connectDialog = viewChild.required(ConnectWalletDialog);
  private run = 0;

  constructor() {
    effect(() => {
      this.network.network();
      const address = this.launchpad.address();
      untracked(() => {
        if (address) void this.load();
        else this.status.set(undefined);
      });
    });
    // The project lists are read only for the admin (they can be long).
    effect(() => {
      if (!this.isAdmin()) return;
      untracked(() => {
        void this.store.load(KIND_TOKEN);
        void this.store.load(KIND_COLLECTION);
      });
    });
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    effect((onCleanup) => onCleanup(() => clearInterval(timer)));
  }

  protected connect(): void {
    this.connectDialog().open();
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected countdown(target: number): string {
    return timeLeft(target, this.now());
  }

  protected errorIn(section: string): string | null {
    const error = this.error();
    return error?.section === section ? error.message : null;
  }

  protected doneIn(section: string): string | null {
    const done = this.done();
    return done?.section === section ? done.message : null;
  }

  // ---- actions ------------------------------------------------------------------------------

  protected async setPaused(paused: boolean): Promise<void> {
    await this.call('status', 'setPaused', new Args().addBool(paused), ADMIN_COINS);
  }

  protected updateFee(key: keyof FeeForm, value: string): void {
    this.feeForm.update((form) => (form ? { ...form, [key]: value } : form));
  }

  protected async saveFees(): Promise<void> {
    const form = this.feeForm();
    const status = this.status();
    if (!form || !status) return;
    const result = configFromForm(form, status.config.paused);
    if ('errors' in result) return;
    await this.call(
      'fees',
      'setConfig',
      writeConfig(new Args(), result.config),
      ADMIN_COINS,
      'Fees saved.',
    );
  }

  protected withdrawAll(): void {
    this.withdrawAmount.set(masText(this.status()?.fees ?? 0n));
  }

  protected withdrawFees(): Promise<void> {
    const amount = this.withdrawNano();
    const to = this.withdrawTo() || this.wallet.address();
    if (!amount || !to || this.withdrawError()) return Promise.resolve();
    return this.call(
      'withdraw',
      'withdrawFees',
      new Args().addString(to).addU64(amount),
      ADMIN_COINS,
      'Fees sent.',
    ).then((ok) => {
      if (ok) this.withdrawAmount.set('');
    });
  }

  protected async setFlag(project: Project, flag: 'verified' | 'hidden'): Promise<void> {
    const func = flag === 'verified' ? 'setVerified' : 'setHidden';
    const value = !project[flag];
    const args = new Args().addU8(BigInt(project.kind)).addU64(project.id).addBool(value);
    const ok = await this.call(`project-${project.kind}-${project.id}`, func, args, ADMIN_COINS);
    if (ok) this.store.upsert(await this.launchpad.project(project.kind, project.id));
  }

  protected setSymbol(value: string): void {
    this.symbol.set(value.trim().toUpperCase());
    this.symbolStatus.set(null);
  }

  protected async checkSymbol(): Promise<void> {
    const symbol = this.symbol();
    if (!symbol || this.symbolInvalid()) return;
    try {
      const status = await this.launchpad.symbolStatus(symbol);
      if (symbol === this.symbol()) this.symbolStatus.set(status);
    } catch (err) {
      this.error.set({ section: 'symbols', message: toUserMessage(err) });
    }
  }

  protected async reserveSymbol(reserved: boolean): Promise<void> {
    const ok = await this.call(
      'symbols',
      'reserveSymbol',
      new Args().addString(this.symbol()).addBool(reserved),
      ADMIN_COINS,
    );
    if (ok) await this.checkSymbol();
  }

  protected async pickTemplate(event: Event): Promise<void> {
    this.templateCode.set(await this.pick(event, 'templates'));
  }

  protected setTemplate(): Promise<void> {
    const code = this.templateCode();
    if (!code) return Promise.resolve();
    return this.call(
      'templates',
      'setTemplate',
      new Args().addU8(BigInt(this.templateKind())).addUint8Array(code.bytes),
      templateCoins(code.bytes.length),
      'Template added.',
    ).then((ok) => {
      if (ok) this.templateCode.set(null);
    });
  }

  protected async pickUpgrade(event: Event): Promise<void> {
    this.upgradeCode.set(await this.pick(event, 'upgrade'));
  }

  protected proposeUpgrade(): Promise<void> {
    const code = this.upgradeCode();
    if (!code) return Promise.resolve();
    const hash = new Uint8Array(code.hash.match(/../g)!.map((h) => parseInt(h, 16)));
    return this.call(
      'upgrade',
      'proposeUpgrade',
      new Args().addUint8Array(hash),
      ADMIN_COINS,
      'Upgrade proposed. It can run in 72 hours.',
    ).then(() => undefined);
  }

  protected cancelUpgrade(): Promise<void> {
    return this.call(
      'upgrade',
      'cancelUpgrade',
      new Args(),
      ADMIN_COINS,
      'Upgrade cancelled.',
    ).then(() => undefined);
  }

  protected executeUpgrade(): Promise<void> {
    const code = this.upgradeCode();
    if (!code || !this.upgradeMatches() || !this.upgradeReady()) return Promise.resolve();
    return this.call(
      'upgrade',
      'executeUpgrade',
      new Args().addUint8Array(code.bytes),
      upgradeCoins(code.bytes.length),
      'The Launchpad runs the new code.',
    ).then((ok) => {
      if (ok) this.upgradeCode.set(null);
    });
  }

  protected offerAdmin(address: string): Promise<void> {
    if (address && !ADDRESS.test(address)) return Promise.resolve();
    return this.call(
      'handover',
      'transferAdmin',
      new Args().addString(address),
      ADMIN_COINS,
      address ? 'Offer sent: the new admin must accept it.' : 'Offer withdrawn.',
    ).then((ok) => {
      if (ok) this.newAdmin.set('');
    });
  }

  protected acceptAdmin(): Promise<void> {
    return this.call(
      'handover',
      'acceptAdmin',
      new Args(),
      ADMIN_COINS,
      'You are the admin now.',
    ).then(() => undefined);
  }

  // ---- internals ----------------------------------------------------------------------------

  /** Sends one admin call, then re-reads the status. Resolves true when it went through. */
  private async call(
    section: string,
    func: string,
    args: Args,
    coins: bigint,
    success?: string,
  ): Promise<boolean> {
    const target = this.launchpad.address();
    if (!target || this.busy()) return false;
    this.busy.set(section);
    this.error.set(null);
    this.done.set(null);
    try {
      await this.transactions.send({ target, func, args, coins });
      if (success) this.done.set({ section, message: success });
      await this.load();
      return true;
    } catch (err) {
      this.error.set({ section, message: toUserMessage(err) });
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  private async pick(event: Event, section: string): Promise<PickedCode | null> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.error.set(null);
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isWasm(bytes)) {
      this.error.set({ section, message: 'This is not a compiled contract (.wasm).' });
      input.value = '';
      return null;
    }
    return { name: file.name, bytes, hash: hex(await sha256(bytes)) };
  }

  private async load(): Promise<void> {
    const run = ++this.run;
    this.loadError.set(null);
    try {
      // One read at a time: the public RPC rejects bursts.
      const version = await this.launchpad.version();
      const admin = await this.launchpad.admin();
      const pendingAdmin = await this.launchpad.pendingAdmin();
      const balance = await this.launchpad.balance();
      const fees = await this.launchpad.collectedFees();
      const config = await this.launchpad.config();
      const upgrade = await this.launchpad.pendingUpgrade();
      const templates: TemplateState[] = [];
      for (const kind of [KIND_TOKEN, KIND_COLLECTION] as ProjectKind[]) {
        const t = await this.launchpad.template(kind);
        const hash = hex(t.hash);
        templates.push({
          kind,
          label: TEMPLATE_LABELS[kind],
          version: t.version,
          hash,
          known: KNOWN_TEMPLATES[kind][t.version] === hash,
        });
      }
      if (run !== this.run) return;
      this.status.set({ version, admin, pendingAdmin, balance, fees, config, upgrade, templates });
      this.feeForm.set(feeFormOf(config));
      if (!this.withdrawTo() && this.wallet.address()) this.withdrawTo.set(this.wallet.address()!);
      this.now.set(Date.now());
    } catch (err) {
      if (run === this.run) this.loadError.set(toUserMessage(err));
    }
  }
}
