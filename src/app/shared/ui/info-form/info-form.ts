import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { infoErrors } from '../../../core/launchpad/launch-rules';
import {
  COLLECTION_CATEGORIES,
  KIND_TOKEN,
  ProjectInfo,
  ProjectKind,
  TOKEN_CATEGORIES,
} from '../../../core/launchpad/records';
import { ProjectLogo } from '../project-logo/project-logo';

type LinkField = 'website' | 'twitter' | 'telegram' | 'discord';

/** The editable presentation of a project: category, description, logo, banner and links. */
@Component({
  selector: 'app-info-form',
  imports: [ProjectLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <span class="field-label">Category</span>
      <div class="chips" role="radiogroup" aria-label="Category">
        @for (label of categories(); track label; let i = $index) {
          <button
            type="button"
            class="chip"
            role="radio"
            [attr.aria-checked]="category() === i"
            [class.selected]="category() === i"
            (click)="category.set(i)"
          >
            {{ label }}
          </button>
        }
      </div>
    </div>

    <label class="field">
      <span>Description</span>
      <textarea
        class="input"
        maxlength="500"
        [class.invalid]="errors().description"
        [value]="info().description"
        (input)="set('description', $event)"
        placeholder="What is this project about?"
      ></textarea>
      <span class="hint">{{ info().description.length }}/500</span>
      @if (errors().description; as error) {
        <span class="error">{{ error }}</span>
      }
    </label>

    <div class="logo-row">
      <app-project-logo [url]="info().logoUrl" [symbol]="symbol()" />
      <label class="field grow">
        <span>Logo URL</span>
        <input
          class="input"
          [class.invalid]="errors().logoUrl"
          [value]="info().logoUrl"
          (input)="set('logoUrl', $event)"
          placeholder="ipfs://… or https://…"
        />
        @if (errors().logoUrl; as error) {
          <span class="error">{{ error }}</span>
        } @else {
          <span class="hint">A square image. We only store the link — host it on IPFS.</span>
        }
      </label>
    </div>

    <label class="field">
      <span>Banner URL</span>
      <input
        class="input"
        [class.invalid]="errors().bannerUrl"
        [value]="info().bannerUrl"
        (input)="set('bannerUrl', $event)"
        placeholder="ipfs://… or https://… (optional)"
      />
      @if (errors().bannerUrl; as error) {
        <span class="error">{{ error }}</span>
      }
    </label>

    <div class="form-grid">
      @for (link of links; track link.key) {
        <label class="field">
          <span>{{ link.label }}</span>
          <input
            class="input"
            [class.invalid]="errors()[link.key]"
            [value]="info()[link.key]"
            (input)="set(link.key, $event)"
            [placeholder]="link.placeholder"
          />
          @if (errors()[link.key]; as error) {
            <span class="error">{{ error }}</span>
          }
        </label>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 18px;
    }

    .logo-row {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      --logo-size: 64px;
    }

    .grow {
      flex: 1;
    }
  `,
})
export class InfoForm {
  readonly kind = input<ProjectKind>(KIND_TOKEN);
  readonly symbol = input('');
  readonly info = model.required<ProjectInfo>();
  readonly category = model.required<number>();

  protected readonly categories = computed(() =>
    this.kind() === KIND_TOKEN ? TOKEN_CATEGORIES : COLLECTION_CATEGORIES,
  );
  protected readonly errors = computed(() => infoErrors(this.info()));
  protected readonly links: { key: LinkField; label: string; placeholder: string }[] = [
    { key: 'website', label: 'Website', placeholder: 'https://…' },
    { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/…' },
    { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/…' },
    { key: 'discord', label: 'Discord', placeholder: 'https://discord.gg/…' },
  ];

  protected set(key: keyof ProjectInfo, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.info.update((info) => ({ ...info, [key]: key === 'description' ? value : value.trim() }));
  }
}
