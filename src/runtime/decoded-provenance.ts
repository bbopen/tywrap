import type { ScientificMarker } from '../utils/codec.js';

/** Metadata from one successfully decoded scientific envelope. */
export interface DecodedShapeMetadata {
  readonly marker: ScientificMarker;
  readonly dims?: number;
  readonly dtype?: string;
}

/** Scalar provenance stays with one decoded call, including nested values. */
export class DecodedProvenance {
  private rootScalar?: DecodedShapeMetadata;
  private readonly children = new WeakMap<object, Map<string | number, DecodedShapeMetadata>>();
  private entries = 0;
  private readonly maxEntries: number;

  constructor(maxEntries = 1_000_000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Decoded provenance entry limit must be a positive safe integer');
    }
    this.maxEntries = maxEntries;
  }

  recordRoot(metadata: DecodedShapeMetadata): void {
    if (this.rootScalar !== undefined) {
      throw new Error('Duplicate root scalar provenance');
    }
    this.claimEntry();
    this.rootScalar = Object.freeze({ ...metadata });
  }

  recordChild(parent: object, key: string | number, metadata: DecodedShapeMetadata): void {
    key = this.normalizeKey(parent, key);
    let entries = this.children.get(parent);
    if (!entries) {
      entries = new Map();
      this.children.set(parent, entries);
    }
    if (entries.has(key)) {
      throw new Error('Duplicate child scalar provenance');
    }
    this.claimEntry();
    entries.set(key, Object.freeze({ ...metadata }));
  }

  atRoot(): DecodedShapeMetadata | undefined {
    return this.rootScalar;
  }

  atChild(parent: object, key: string | number): DecodedShapeMetadata | undefined {
    return this.children.get(parent)?.get(this.normalizeKey(parent, key));
  }

  private normalizeKey(parent: object, key: string | number): string | number {
    if (
      Array.isArray(parent) &&
      typeof key === 'string' &&
      /^(0|[1-9]\d*)$/.test(key) &&
      Number.isSafeInteger(Number(key))
    ) {
      return Number(key);
    }
    return key;
  }

  private claimEntry(): void {
    if (this.entries >= this.maxEntries) {
      throw new Error(`Decoded scalar provenance exceeds ${this.maxEntries} entries`);
    }
    this.entries += 1;
  }
}
