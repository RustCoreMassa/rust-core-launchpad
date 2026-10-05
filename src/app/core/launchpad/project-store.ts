import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { NetworkStore } from '../network/network-store';
import { toUserMessage } from '../utils/user-error';
import { LaunchpadReader, PAGE_SIZE } from './launchpad-reader';
import { Project, ProjectKind } from './records';

/** Safety cap for the in-browser list: beyond it, an indexer. */
export const MAX_LOADED = 2_000;

export interface ProjectList {
  readonly projects: readonly Project[];
  /** False until the first page arrived — show skeletons, never an empty "nothing here". */
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY: ProjectList = { projects: [], loaded: false, loading: false, error: null };

/**
 * Every project of a kind on the selected network, read page by page (newest first) and kept
 * in memory; filters and search run in the browser over this list. Pages load one at a time,
 * because the public RPC rejects bursts. Changing network starts over.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private readonly reader = inject(LaunchpadReader);
  private readonly networks = inject(NetworkStore);
  private readonly lists = [signal<ProjectList>(EMPTY), signal<ProjectList>(EMPTY)];
  private generation = 0;

  constructor() {
    effect(() => {
      this.networks.network();
      untracked(() => {
        this.generation++;
        for (const list of this.lists) list.set(EMPTY);
      });
    });
  }

  list(kind: ProjectKind) {
    return this.lists[kind].asReadonly();
  }

  /** Loads the list if it isn't loaded or loading (pass `force` to reload). */
  async load(kind: ProjectKind, force = false): Promise<void> {
    const list = this.lists[kind];
    if (list().loading || (list().loaded && !force)) return;
    const generation = this.generation;
    list.update((l) => ({ ...l, loading: true, error: null }));
    try {
      const projects: Project[] = [];
      let total = Infinity;
      while (projects.length < Math.min(total, MAX_LOADED)) {
        const page = await this.reader.projects(kind, projects.length, PAGE_SIZE);
        if (generation !== this.generation) return;
        total = page.total;
        if (!page.projects.length) break;
        projects.push(...page.projects);
        list.set({ projects: [...projects], loaded: true, loading: true, error: null });
      }
      list.set({ projects, loaded: true, loading: false, error: null });
    } catch (err) {
      if (generation !== this.generation) return;
      list.update((l) => ({ ...l, loaded: true, loading: false, error: toUserMessage(err) }));
    }
  }

  /** Puts a fresh record in the list (after a launch or an edit) without reloading it all. */
  upsert(project: Project): void {
    this.lists[project.kind].update((list) => {
      const others = list.projects.filter((p) => p.id !== project.id);
      const projects = [project, ...others].sort((a, b) => (a.id > b.id ? -1 : 1));
      return { ...list, projects };
    });
  }
}
