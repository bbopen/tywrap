/**
 * Intelligent Caching System for tywrap
 * Provides multi-level caching with invalidation strategies and performance monitoring
 */

import { createHash } from 'crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'path';

import type { AnalysisResult, PythonModule, GeneratedCode } from '../types/index.js';
import { getComponentLogger } from './logger.js';

const log = getComponentLogger('Cache');

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
  version: string;
  dependencies: string[];
  metadata: {
    size: number;
    hitCount: number;
    lastAccessed: number;
    computeTime: number; // Time to generate this entry
    memoryFootprint: number;
  };
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  averageComputeTime: number;
  topKeys: Array<{ key: string; hitCount: number; size: number }>;
  memoryUsage: number;
}

export interface CacheConfig {
  baseDir: string;
  maxSize: number; // Maximum cache size in bytes
  maxAge: number; // Maximum age in milliseconds
  maxEntries: number; // Maximum number of entries
  compressionEnabled: boolean;
  persistToDisk: boolean;
  cleanupInterval: number; // Cleanup interval in milliseconds
  debug?: boolean;
}

export class IntelligentCache {
  private memoryCache = new Map<string, CacheEntry>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalComputeTime: 0,
  };
  private config: CacheConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private compressionAvailable = false;
  private debug = false;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      baseDir: join(process.cwd(), '.tywrap-cache'),
      maxSize: 100 * 1024 * 1024, // 100MB
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxEntries: 1000,
      compressionEnabled: true,
      persistToDisk: true,
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      debug: false,
      ...config,
    };

    this.debug = this.config.debug ?? false;

    if (this.config.persistToDisk) {
      this.safeMkdir(this.config.baseDir).catch(error => {
        log.warn('Failed to create cache directory', { error: String(error) });
      });
    }

    // Check for compression availability
    try {
      require.resolve('zlib');
      this.compressionAvailable = this.config.compressionEnabled;
    } catch {
      this.compressionAvailable = false;
    }

    // Start periodic cleanup
    if (this.config.cleanupInterval > 0) {
      this.startCleanupScheduler();
    }

    if (this.config.persistToDisk) {
      this.safeMkdir(this.config.baseDir)
        .then(() => this.loadFromDisk())
        .catch(error => {
          log.warn('Failed to initialize disk cache', { error: String(error) });
        });
    }
  }

  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  private debugLog(message: string): void {
    if (!this.debug) {
      return;
    }
    process.stdout.write(`${message}\n`);
  }

  private async safeMkdir(path: string): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path is internal
    await fs.mkdir(path, { recursive: true });
  }

  private async safeReaddir(path: string): Promise<string[]> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path is internal
    return fs.readdir(path);
  }

  private async safeReadFile(path: string): Promise<string> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path is internal
    return fs.readFile(path, 'utf8');
  }

  private async safeWriteFile(path: string, data: string): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path is internal
    await fs.writeFile(path, data);
  }

  private async safeUnlink(path: string): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path is internal
    await fs.unlink(path);
  }

  /**
   * Generate cache key from input parameters
   */
  generateKey(prefix: string, ...inputs: unknown[]): string {
    const hash = createHash('sha256');

    // Add prefix
    hash.update(prefix);
    hash.update('\0');

    // Add inputs
    for (const input of inputs) {
      // Why: disambiguate types so "1" and 1 don't collide, and keep input boundaries so
      // ["a", "bc"] doesn't collide with ["ab", "c"].
      if (input === undefined) {
        hash.update('undef:');
        hash.update('\0');
        continue;
      }
      if (input === null) {
        hash.update('null:');
        hash.update('\0');
        continue;
      }
      if (typeof input === 'string') {
        hash.update('str:');
        hash.update(input);
        hash.update('\0');
        continue;
      }
      if (typeof input === 'number') {
        hash.update('num:');
        hash.update(String(input));
        hash.update('\0');
        continue;
      }
      if (typeof input === 'boolean') {
        hash.update('bool:');
        hash.update(input ? '1' : '0');
        hash.update('\0');
        continue;
      }
      if (typeof input === 'bigint') {
        hash.update('bigint:');
        hash.update(input.toString());
        hash.update('\0');
        continue;
      }
      if (Buffer.isBuffer(input)) {
        hash.update('buf:');
        hash.update(input);
        hash.update('\0');
        continue;
      }

      hash.update('json:');
      hash.update(JSON.stringify(input));
      hash.update('\0');
    }

    return hash.digest('hex').substring(0, 16); // Use first 16 chars for readability
  }

  /**
   * Get entry from cache with performance tracking
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = performance.now();

    // Try memory cache first
    const entry = this.memoryCache.get(key);
    if (entry) {
      // Check if entry is still valid
      if (this.isEntryValid(entry)) {
        entry.metadata.hitCount++;
        entry.metadata.lastAccessed = Date.now();
        this.stats.hits++;

        this.debugLog(
          `Cache HIT [${key}] (memory) - ${(performance.now() - startTime).toFixed(2)}ms`
        );
        return entry.data as T;
      } else {
        this.memoryCache.delete(key);
      }
    }

    // Try disk cache if enabled
    if (this.config.persistToDisk) {
      const diskEntry = await this.loadFromDiskKey<T>(key);
      if (diskEntry && this.isEntryValid(diskEntry)) {
        // Move to memory cache
        this.memoryCache.set(key, diskEntry);
        diskEntry.metadata.hitCount++;
        diskEntry.metadata.lastAccessed = Date.now();
        this.stats.hits++;

        this.debugLog(
          `Cache HIT [${key}] (disk) - ${(performance.now() - startTime).toFixed(2)}ms`
        );
        return diskEntry.data;
      }
    }

    this.stats.misses++;
    this.debugLog(`Cache MISS [${key}] - ${(performance.now() - startTime).toFixed(2)}ms`);
    return null;
  }

  /**
   * Store entry in cache with metadata
   */
  async set<T>(
    key: string,
    data: T,
    options: {
      dependencies?: string[];
      computeTime?: number;
      version?: string;
    } = {}
  ): Promise<void> {
    const startTime = performance.now();

    const entry: CacheEntry<T> = {
      key,
      data,
      timestamp: Date.now(),
      version: options.version ?? '1.0.0',
      dependencies: options.dependencies ?? [],
      metadata: {
        size: this.estimateSize(data),
        hitCount: 0,
        lastAccessed: Date.now(),
        computeTime: options.computeTime ?? 0,
        memoryFootprint: process.memoryUsage().heapUsed,
      },
    };

    // Update stats
    if (options.computeTime) {
      this.stats.totalComputeTime += options.computeTime;
    }

    // Store in memory cache
    this.memoryCache.set(key, entry);

    // Store to disk if enabled
    if (this.config.persistToDisk) {
      await this.saveToDiskKey(key, entry);
    }

    // Trigger cleanup if needed
    await this.cleanup();

    this.debugLog(`Cache SET [${key}] - ${(performance.now() - startTime).toFixed(2)}ms`);
  }

  /**
   * Cached IR extraction with dependency tracking
   */
  async getCachedAnalysis(
    sourceCode: string,
    modulePath: string,
    version: string = '1.0.0'
  ): Promise<AnalysisResult | null> {
    const dependencies = this.extractDependencies(sourceCode);
    const key = this.generateKey('analysis', sourceCode, modulePath, version, dependencies);

    const cached = await this.get<AnalysisResult>(key);
    if (cached) {
      return cached;
    }

    return null;
  }

  /**
   * Store analysis result with dependency tracking
   */
  async setCachedAnalysis(
    sourceCode: string,
    modulePath: string,
    result: AnalysisResult,
    computeTime: number,
    version: string = '1.0.0'
  ): Promise<void> {
    const dependencies = this.extractDependencies(sourceCode);
    const key = this.generateKey('analysis', sourceCode, modulePath, version, dependencies);

    await this.set(key, result, {
      dependencies: [modulePath, ...dependencies],
      computeTime,
      version,
    });
  }

  /**
   * Cached code generation
   */
  async getCachedGeneration(
    module: PythonModule,
    options: { moduleName: string; exportAll?: boolean },
    version: string = '1.0.0'
  ): Promise<GeneratedCode | null> {
    const key = this.generateKey('generation', module, options, version);
    return this.get<GeneratedCode>(key);
  }

  /**
   * Store generated code
   */
  async setCachedGeneration(
    module: PythonModule,
    options: { moduleName: string; exportAll?: boolean },
    result: GeneratedCode,
    computeTime: number,
    version: string = '1.0.0'
  ): Promise<void> {
    const key = this.generateKey('generation', module, options, version);

    await this.set(key, result, {
      dependencies: [options.moduleName],
      computeTime,
      version,
    });
  }

  /**
   * Invalidate cache entries based on dependencies
   */
  async invalidateByDependency(dependency: string): Promise<number> {
    let invalidatedCount = 0;

    // Invalidate memory cache
    for (const [key, entry] of this.memoryCache) {
      if (entry.dependencies.includes(dependency)) {
        this.memoryCache.delete(key);
        invalidatedCount++;
      }
    }

    // Invalidate disk cache if enabled
    if (this.config.persistToDisk) {
      const diskInvalidated = await this.invalidateDiskByDependency(dependency);
      invalidatedCount += diskInvalidated;
    }

    this.debugLog(`Invalidated ${invalidatedCount} cache entries for dependency: ${dependency}`);
    return invalidatedCount;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.memoryCache.values());
    const totalSize = entries.reduce((sum, entry) => sum + entry.metadata.size, 0);
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses);
    const averageComputeTime = this.stats.totalComputeTime / Math.max(1, this.stats.hits);

    const topKeys = entries
      .sort((a, b) => b.metadata.hitCount - a.metadata.hitCount)
      .slice(0, 10)
      .map(entry => ({
        key: entry.key,
        hitCount: entry.metadata.hitCount,
        size: entry.metadata.size,
      }));

    return {
      totalEntries: this.memoryCache.size,
      totalSize,
      hitRate: isNaN(hitRate) ? 0 : hitRate,
      averageComputeTime,
      topKeys,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    if (this.config.persistToDisk) {
      try {
        const files = await this.safeReaddir(this.config.baseDir);
        await Promise.all(
          files
            .filter(file => file.endsWith('.cache'))
            .map(file =>
              this.safeUnlink(join(this.config.baseDir, file)).catch(error =>
                log.warn('Failed to remove cache file', { file, error: String(error) })
              )
            )
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn('Failed to clear disk cache', { error: String(error) });
        }
      }
    }

    this.stats = { hits: 0, misses: 0, evictions: 0, totalComputeTime: 0 };
  }

  /**
   * Cleanup old and large entries
   */
  private async cleanup(): Promise<void> {
    const entries = Array.from(this.memoryCache.entries());
    let totalSize = entries.reduce((sum, [, entry]) => sum + entry.metadata.size, 0);

    // Remove expired entries
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > this.config.maxAge) {
        this.memoryCache.delete(key);
        this.stats.evictions++;
        totalSize -= entry.metadata.size;
      }
    }

    // Remove entries if over limit
    if (this.memoryCache.size > this.config.maxEntries || totalSize > this.config.maxSize) {
      // Sort by least recently used
      const sorted = Array.from(this.memoryCache.entries()).sort(
        (a, b) => a[1].metadata.lastAccessed - b[1].metadata.lastAccessed
      );

      while (
        (this.memoryCache.size > this.config.maxEntries || totalSize > this.config.maxSize) &&
        sorted.length > 0
      ) {
        const next = sorted.shift();
        if (!next) {
          break;
        }
        const [key, entry] = next;
        this.memoryCache.delete(key);
        this.stats.evictions++;
        totalSize -= entry.metadata.size;
      }
    }
  }

  /**
   * Check if cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry): boolean {
    const now = Date.now();
    return now - entry.timestamp < this.config.maxAge;
  }

  /**
   * Estimate data size for cache management
   */
  private estimateSize(data: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(data), 'utf8');
    } catch {
      return 1024; // Default estimate
    }
  }

  /**
   * Extract dependencies from Python source code
   */
  private extractDependencies(sourceCode: string): string[] {
    const dependencies: string[] = [];
    const importRegex = /(?:from\s+(\w+)|import\s+(\w+))/g;

    let match;
    while ((match = importRegex.exec(sourceCode)) !== null) {
      const module = match[1] ?? match[2];
      if (module && !dependencies.includes(module)) {
        dependencies.push(module);
      }
    }

    return dependencies;
  }

  /**
   * Load cache entries from disk
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const files = await this.safeReaddir(this.config.baseDir);
      let loadedCount = 0;

      for (const file of files) {
        if (file.endsWith('.cache')) {
          try {
            const key = file.replace('.cache', '');
            const entry = await this.loadFromDiskKey<unknown>(key);

            if (entry && this.isEntryValid(entry)) {
              this.memoryCache.set(key, entry);
              loadedCount++;
            }
          } catch (error) {
            log.warn('Failed to load cache file', { file, error: String(error) });
          }
        }
      }

      if (loadedCount > 0) {
        this.debugLog(`Loaded ${loadedCount} cache entries from disk`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to load cache from disk', { error: String(error) });
      }
    }
  }

  /**
   * Load specific key from disk
   */
  private async loadFromDiskKey<T>(key: string): Promise<CacheEntry<T> | null> {
    const filePath = join(this.config.baseDir, `${key}.cache`);

    try {
      const data = await this.safeReadFile(filePath);
      let parsed;

      if (this.compressionAvailable && data.startsWith('COMPRESSED:')) {
        const zlib = await import('zlib');
        const compressed = Buffer.from(data.substring(11), 'base64');
        const decompressed = zlib.gunzipSync(compressed);
        parsed = JSON.parse(decompressed.toString('utf8'));
      } else {
        parsed = JSON.parse(data);
      }

      return parsed as CacheEntry<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to load cache key', { key, error: String(error) });
      }
      return null;
    }
  }

  /**
   * Save specific key to disk
   */
  private async saveToDiskKey<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const filePath = join(this.config.baseDir, `${key}.cache`);

    try {
      // Ensure directory exists
      await this.safeMkdir(dirname(filePath));

      let data = JSON.stringify(entry);

      // Compress if enabled and beneficial
      if (this.compressionAvailable && data.length > 1024) {
        try {
          const zlib = await import('zlib');
          const compressed = zlib.gzipSync(Buffer.from(data, 'utf8'));
          if (compressed.length < data.length * 0.8) {
            data = `COMPRESSED:${compressed.toString('base64')}`;
          }
        } catch (error) {
          log.warn('Compression failed', { key, error: String(error) });
        }
      }

      await this.safeWriteFile(filePath, data);
    } catch (error) {
      log.warn('Failed to save cache key', { key, error: String(error) });
    }
  }

  /**
   * Invalidate disk cache by dependency
   */
  private async invalidateDiskByDependency(dependency: string): Promise<number> {
    let invalidatedCount = 0;
    try {
      const files = await this.safeReaddir(this.config.baseDir);

      for (const file of files) {
        if (file.endsWith('.cache')) {
          try {
            const key = file.replace('.cache', '');
            const entry = await this.loadFromDiskKey(key);

            if (entry?.dependencies.includes(dependency)) {
              await this.safeUnlink(join(this.config.baseDir, file));
              invalidatedCount++;
            }
          } catch (error) {
            log.warn('Failed to check cache file', { file, error: String(error) });
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to invalidate disk cache', { error: String(error) });
      }
    }

    return invalidatedCount;
  }

  /**
   * Start periodic cleanup scheduler
   */
  private startCleanupScheduler(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanup();
    }, this.config.cleanupInterval);
    this.cleanupTimer.unref?.();
  }

  /**
   * Dispose cache and cleanup resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

// Export singleton instance
export const globalCache = new IntelligentCache();
