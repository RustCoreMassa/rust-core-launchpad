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
import { LaunchpadReader } from '../../core/launchpad/launchpad-reader';
import { ProjectStore } from '../../core/launchpad/project-store';
import {
  COLLECTION_CATEGORIES,
  KIND_TOKEN,
  Project,
  ProjectKind,
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

/** Texts and links per kind. */
const PAGES = {
  [KIND_TOKEN]: {
    label: 'Tokens',
    title: 'Explore tokens',
    lead: 'Every MRC20 token launched or imported through the Launchpad.',
    noun: 'tokens',
    base: '/tokens',
    create: '/create/token',
    createLabel: 'Create a token',
  },
  1: {
    label: 'NFT',
    title: 'Explore collections',
    lead: 'Every NFT collection launched or imported through the Launchpad.',
    noun: 'collections',
    base: '/collections',
    create: '/create/collection',
    createLabel: 'Create a collection',
  },
} as const;

/**
 * Every token or collection in the Launchpad (the kind comes from the route's data). The list
 * is read once into the browser; search, category, source, verified and sort apply there.
 */
@Component({
  selector: 'app-explore-page',
  imports: [RouterLink, ProjectLogo, ProjectBadges],
  templateUrl: './explore-page.html',
  styleUrl: './explore-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  /** Route data. */
  readonly kind = input<ProjectKind>(KIND_TOKEN);
  private readonly store = inject(ProjectStore);
  protected readonly launchpad = inject(LaunchpadReader);
  protected readonly network = inject(NetworkStore);

  protected readonly page = computed(() => PAGES[this.kind()]);
  protected readonly list = computed(() => this.store.list(this.kind())());
  protected readonly categories = computed(() =>
    this.kind() === KIND_TOKEN ? TOKEN_CATEGORIES : COLLECTION_CATEGORIES,
  );
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
      const kind = this.kind();
      if (this.launchpad.address()) untracked(() => void this.store.load(kind));
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
    return categoryLabel(project.kind, project.category);
  }

  protected toggleCategory(index: number): void {
    this.category.update((current) => (current === index ? null : index));
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    void this.store.load(this.kind(), true);
  }
}

export function sortProjects(projects: Project[], sort: Sort): Project[] {
  const sorted = [...projects];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'oldest') sorted.sort((a, b) => (a.id < b.id ? -1 : 1));
  else sorted.sort((a, b) => (a.id > b.id ? -1 : 1));
  return sorted;
}
