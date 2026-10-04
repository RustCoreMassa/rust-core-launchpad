import { Injectable } from '@angular/core';
import { httpUrl } from '../utils/ipfs';

export interface NftAttribute {
  trait: string;
  value: string;
}

/** The usual NFT metadata JSON, cleaned: every field is plain text, the image a loadable URL. */
export interface NftMetadata {
  name: string;
  description: string;
  /** https URL ('' when missing or unusable). */
  image: string;
  attributes: NftAttribute[];
}

const MAX_TEXT = 2_000;
const MAX_ATTRIBUTES = 50;
const TIMEOUT_MS = 15_000;

/**
 * Reads NFT metadata JSON (from IPFS through the gateway, or https). The JSON is written by the
 * collection's creator, so nothing in it is trusted: only known fields are kept, as text, and
 * only https / ipfs image links. Results are cached per URL for the session.
 */
@Injectable({ providedIn: 'root' })
export class NftMetadataLoader {
  private readonly cache = new Map<string, Promise<NftMetadata | null>>();

  /** null when the URI can't be loaded or isn't metadata JSON. */
  load(uri: string): Promise<NftMetadata | null> {
    let entry = this.cache.get(uri);
    if (!entry) {
      entry = this.fetch(uri);
      this.cache.set(uri, entry);
    }
    return entry;
  }

  private async fetch(uri: string): Promise<NftMetadata | null> {
    const url = httpUrl(uri);
    if (!url) return null;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
      if (!response.ok) return null;
      return parseMetadata(await response.json());
    } catch {
      return null;
    }
  }
}

export function parseMetadata(json: unknown): NftMetadata | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const data = json as Record<string, unknown>;
  const attributes = Array.isArray(data['attributes']) ? data['attributes'] : [];
  return {
    name: text(data['name']),
    description: text(data['description']),
    image: httpUrl(text(data['image'])),
    attributes: attributes
      .slice(0, MAX_ATTRIBUTES)
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({ trait: text(a['trait_type']), value: text(a['value']) }))
      .filter((a) => a.trait !== '' && a.value !== ''),
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
