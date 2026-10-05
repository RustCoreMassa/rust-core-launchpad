import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import {
  PHASE_LABELS,
  PresalePhase,
  presalePhase,
  timeLeft,
} from '../../core/launchpad/presale-state';
import { ProjectStore } from '../../core/launchpad/project-store';
import { KIND_TOKEN, Presale, Project } from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { toUserMessage } from '../../core/utils/user-error';
import { PresaleProgress } from '../../shared/ui/presale-progress/presale-progress';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';

type Filter = 'all' | 'live' | 'upcoming' | 'ended' | 'success' | 'closed';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'ended', label: 'Awaiting finalization' },
  { id: 'success', label: 'Successful' },
  { id: 'closed', label: 'Failed / cancelled' },
];

/** Every presale in the Launchpad, live first. */
@Component({
  selector: 'app-presales-page',
  imports: [RouterLink, ProjectLogo, PresaleProgress],
  templateUrl: './presales-page.html',
  styleUrl: './presales-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresalesPage {
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);
  private readonly store = inject(ProjectStore);

  /** null while loading. */
  protected readonly presales = signal<Presale[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<Filter>('all');
  protected readonly filters = FILTERS;
  protected readonly labels = PHASE_LABELS;
  /** Re-evaluates phases and countdowns once a minute. */
  protected readonly now = signal(Date.now());

  private readonly tokens = this.store.list(KIND_TOKEN);
  private readonly byAddress = computed(() => {
    const map = new Map<string, Project>();
    for (const p of this.tokens().projects) map.set(p.address, p);
    return map;
  });
  protected readonly visible = computed(() => {
    const now = this.now();
    const filter = this.filter();
    const order: PresalePhase[] = ['live', 'upcoming', 'ended', 'success', 'failed', 'cancelled'];
    return (this.presales() ?? [])
      .filter((p) => !this.byAddress().get(p.token)?.hidden)
      .map((p) => ({ presale: p, phase: presalePhase(p, now) }))
      .filter(({ phase }) =>
        filter === 'all'
          ? true
          : filter === 'closed'
            ? phase === 'failed' || phase === 'cancelled'
            : phase === filter,
      )
      .sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  });

  private run = 0;

  constructor() {
    effect(() => {
      this.network.network();
      const address = this.launchpad.address();
      untracked(() => (address ? void this.load() : this.presales.set([])));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    effect((onCleanup) => onCleanup(() => clearInterval(timer)));
  }

  protected token(p: Presale): Project | undefined {
    return this.byAddress().get(p.token);
  }

  protected countdown(p: Presale, phase: PresalePhase): string {
    if (phase === 'upcoming') return `Starts in ${timeLeft(p.start, this.now())}`;
    if (phase === 'live') return `Ends in ${timeLeft(p.end, this.now())}`;
    return this.labels[phase];
  }

  private async load(): Promise<void> {
    const run = ++this.run;
    this.presales.set(null);
    this.error.set(null);
    try {
      await this.store.load(KIND_TOKEN);
      const all = await this.launchpad.allPresales();
      if (run === this.run) this.presales.set(all);
    } catch (err) {
      if (run !== this.run) return;
      this.error.set(toUserMessage(err));
      this.presales.set([]);
    }
  }
}
