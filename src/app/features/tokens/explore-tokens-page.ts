import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  KIND_TOKEN,
  Project,
  SOURCE_IMPORTED,
  SOURCE_LAUNCHED,
  TOKEN_CATEGORIES,
  categoryLabel,
} from '../../core/launchpad/records';
import { NetworkStore } from '../../core/network/network-store';
import { ProjectBadges } from '../../shared/ui/project-badges/project-badges';
import { ProjectLogo } from '../../shared/ui/project-logo/project-logo';

type SourceFilter = 'all' | 'launched' | 'imported';
type Sort = 'newest' | 'oldest' | 'name';

/** Shows this many cards, then "Show more" (the list itself is already in memory). */
const STEP = 24;

/**
 * Every token in the Launchpad. Filters (docs/ANALYSIS.md, "Indexare, filtre"): the list is read
 * once into the browser and search, category, source, verified and sort apply there.
 */
@Component({
  selector: 'app-explore-tokens-page',
  imports: [RouterLink, ProjectLogo, ProjectBadges],
  templateUrl: './explore-tokens-page.html',
  styleUrl: './explore-tokens-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreTokensPage {
  private readonly store = inject(ProjectStore);
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);

  protected readonly list = this.store.list(KIND_TOKEN);
  protected readonly categories = TOKEN_CATEGORIES;
  protected readonly query = signal('');
  protected readonly category = signal<number | null>(null);
  protected readonly source = signal<SourceFilter>('all');
  protected readonly verifiedOnly = signal(false);
  protected readonly sort = signal<Sort>('newest');
  protected readonly shown = signal(STEP);

  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const category = this.category();
    const source = this.source();
    const verifiedOnly = this.verifiedOnly();
    const matches = this.list().projects.filter(
      (p) =>
        !p.hidden &&
        (category === null || p.category === category) &&
        (source === 'all' ||
          (source === 'launched' ? p.source === SOURCE_LAUNCHED : p.source === SOURCE_IMPORTED)) &&
        (!verifiedOnly || p.verified) &&
        (!query ||
          p.name.toLowerCase().includes(query) ||
          p.symbol.toLowerCase().includes(query) ||
          p.address.toLowerCase() === query),
    );
    return sortProjects(matches, this.sort());
  });
  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  constructor() {
    effect(() => {
      if (this.launchpad.address()) void this.store.load(KIND_TOKEN);
    });
    // A new filter starts from the first cards again.
    effect(() => {
      this.query();
      this.category();
      this.source();
      this.verifiedOnly();
      this.sort();
      this.shown.set(STEP);
    });
  }

  protected label(project: Project): string {
    return categoryLabel(KIND_TOKEN, project.category);
  }

  protected toggleCategory(index: number): void {
    this.category.update((current) => (current === index ? null : index));
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    void this.store.load(KIND_TOKEN, true);
  }
}

export function sortProjects(projects: Project[], sort: Sort): Project[] {
  const sorted = [...projects];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'oldest') sorted.sort((a, b) => (a.id < b.id ? -1 : 1));
  else sorted.sort((a, b) => (a.id > b.id ? -1 : 1));
  return sorted;
}
