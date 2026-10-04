import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page container">
      <header class="page-head">
        <span class="label">404</span>
        <h1>Page not found</h1>
        <p>This address doesn't match any page of the Launchpad.</p>
      </header>
      <a class="btn btn-red" routerLink="/">Go to home</a>
    </section>
  `,
})
export class NotFoundPage {}
