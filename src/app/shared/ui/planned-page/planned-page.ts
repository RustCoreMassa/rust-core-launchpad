import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

export interface PlannedPageData {
  readonly label: string;
  readonly heading: string;
  readonly text: string;
  /** Development phase that delivers the page. */
  readonly phase: number;
}

/** Stand-in for a page that a later development phase builds. */
@Component({
  selector: 'app-planned-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page container">
      <header class="page-head">
        <span class="label">{{ page().label }}</span>
        <h1>{{ page().heading }}</h1>
        <p>{{ page().text }}</p>
      </header>
      <div class="card planned">
        <span class="pill"
          ><span class="dot dot-warn"></span>Coming in phase {{ page().phase }}</span
        >
        <p class="muted">This page is part of the Launchpad roadmap and isn't built yet.</p>
        <a class="btn btn-ghost btn-sm" routerLink="/">Back to home</a>
      </div>
    </section>
  `,
  styles: `
    .planned {
      display: grid;
      justify-items: start;
      gap: 12px;
      max-width: 560px;
    }

    .planned p {
      margin: 0;
    }
  `,
})
export class PlannedPage {
  private readonly data = toSignal(inject(ActivatedRoute).data, { requireSync: true });
  protected readonly page = computed(() => this.data() as PlannedPageData);
}
