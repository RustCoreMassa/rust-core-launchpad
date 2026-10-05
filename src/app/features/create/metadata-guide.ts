import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { FOLDER_TREE, METADATA_EXAMPLE_JSON } from './metadata-example';

/** How to prepare NFT metadata: folder layout (folder mode), the JSON format, the usual traps. */
@Component({
  selector: 'app-metadata-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="guide">
      <summary>How to prepare your metadata</summary>
      <div class="body">
        @if (mode() === 'folder') {
          <p>
            Each NFT has a JSON file named after its number. Upload the images first, then the
            metadata folder, and paste the metadata folder's link here.
          </p>
          <pre class="mono">{{ tree }}</pre>
        } @else {
          <p>
            Each NFT has its own JSON file, anywhere on IPFS or HTTPS. You give its link when you
            mint that NFT.
          </p>
        }
        <div class="example-head">
          <span class="field-label">{{ mode() === 'folder' ? '1.json' : 'Metadata file' }}</span>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" type="button" (click)="copy()">
              {{ copied() ? 'Copied ✓' : 'Copy' }}
            </button>
            <button class="btn btn-ghost btn-sm" type="button" (click)="download()">
              Download
            </button>
          </div>
        </div>
        <pre class="mono">{{ json }}</pre>
        <ul class="hint">
          <li>
            <strong>name</strong>, <strong>description</strong>, <strong>image</strong> (ipfs:// or
            https://) and <strong>attributes</strong> (trait_type + value) are shown; other fields
            are ignored.
          </li>
          @if (mode() === 'folder') {
            <li>Numbers start at <strong>1</strong>: a 0.json is never read.</li>
            <li>
              Files are named <span class="mono">1.json</span>, not <span class="mono">1</span>.
            </li>
            <li>The folder link ends with <span class="mono">/</span>.</li>
          }
          <li>Attributes become the trait filters on your collection page.</li>
        </ul>
      </div>
    </details>
  `,
  styles: `
    .guide {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
    }

    summary {
      cursor: pointer;
      font-weight: 600;
    }

    .body {
      display: grid;
      gap: 12px;
      margin-top: 12px;
    }

    .body p {
      margin: 0;
    }

    pre {
      margin: 0;
      padding: 12px;
      overflow-x: auto;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
      font-size: 13px;
      line-height: 1.5;
    }

    .example-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    ul {
      display: grid;
      gap: 4px;
      margin: 0;
      padding-left: 18px;
    }
  `,
})
export class MetadataGuide {
  readonly mode = input<'folder' | 'perToken'>('folder');
  protected readonly tree = FOLDER_TREE;
  protected readonly json = METADATA_EXAMPLE_JSON;
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.json);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2_000);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  }

  protected download(): void {
    const url = URL.createObjectURL(new Blob([this.json + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '1.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
