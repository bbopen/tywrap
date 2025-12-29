/**
 * Memory Profiler and Leak Detection for tywrap
 * Comprehensive memory monitoring and analysis tools
 */

import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';
import type { PerformanceEntry, PerformanceObserverEntryList } from 'node:perf_hooks';

export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  gcCount: number;
  operation?: string;
  metadata?: Record<string, unknown>;
}

export interface LeakAnalysis {
  detected: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  growthRate: number; // bytes per second
  suspiciousOperations: string[];
  recommendations: string[];
  snapshots: MemorySnapshot[];
}

export interface MemoryReport {
  summary: {
    duration: number;
    totalOperations: number;
    peakMemory: number;
    averageMemory: number;
    memoryGrowth: number;
    gcEfficiency: number;
  };
  leakAnalysis: LeakAnalysis;
  operationMetrics: Map<
    string,
    {
      count: number;
      averageMemoryDelta: number;
      maxMemoryDelta: number;
      totalMemoryAllocated: number;
    }
  >;
  recommendations: string[];
}

export class MemoryProfiler extends EventEmitter {
  private snapshots: MemorySnapshot[] = [];
  private operationMetrics = new Map<
    string,
    {
      count: number;
      averageMemoryDelta: number;
      maxMemoryDelta: number;
      totalMemoryAllocated: number;
    }
  >();
  private monitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private baselineSnapshot?: MemorySnapshot;
  private gcCount = 0;
  private options: {
    snapshotInterval: number;
    maxSnapshots: number;
    leakThreshold: number; // bytes per second growth rate
    enableGCTracking: boolean;
  };

  constructor(options: Partial<typeof MemoryProfiler.prototype.options> = {}) {
    super();
    this.options = {
      snapshotInterval: 5000, // 5 seconds
      maxSnapshots: 100,
      leakThreshold: 1024 * 1024, // 1MB per second
      enableGCTracking: true,
      ...options,
    };

    if (this.options.enableGCTracking) {
      this.setupGCTracking();
    }
  }

  private logInfo(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(): void {
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    this.baselineSnapshot = this.takeSnapshot('monitoring_start');

    this.monitoringInterval = setInterval(() => {
      const snapshot = this.takeSnapshot('periodic');
      this.emit('snapshot', snapshot);

      // Check for immediate leak concerns
      const analysis = this.analyzeLeaks();
      if (analysis.detected && analysis.severity === 'critical') {
        this.emit('critical_leak', analysis);
      }
    }, this.options.snapshotInterval);

    this.logInfo('Memory monitoring started');
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.takeSnapshot('monitoring_stop');
    this.emit('monitoring_stopped', this.generateReport());

    this.logInfo('Memory monitoring stopped');
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(operation?: string, metadata?: Record<string, unknown>): MemorySnapshot {
    const memUsage = process.memoryUsage();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers,
      gcCount: this.gcCount,
      operation,
      metadata,
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    if (this.snapshots.length > this.options.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * Profile a specific operation
   */
  async profileOperation<T>(
    operationName: string,
    operation: () => Promise<T> | T,
    metadata?: Record<string, unknown>
  ): Promise<{ result: T; memoryDelta: number; duration: number }> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      await this.sleep(100); // Let GC settle
    }

    const beforeSnapshot = this.takeSnapshot(`${operationName}_start`, metadata);
    const startTime = performance.now();

    try {
      const result = await operation();
      const endTime = performance.now();

      // Force GC again to get accurate measurement
      if (global.gc) {
        global.gc();
        await this.sleep(100);
      }

      const afterSnapshot = this.takeSnapshot(`${operationName}_end`, metadata);

      const memoryDelta = afterSnapshot.heapUsed - beforeSnapshot.heapUsed;
      const duration = endTime - startTime;

      // Update operation metrics
      const existing = this.operationMetrics.get(operationName) ?? {
        count: 0,
        averageMemoryDelta: 0,
        maxMemoryDelta: 0,
        totalMemoryAllocated: 0,
      };

      existing.count++;
      existing.totalMemoryAllocated += Math.max(0, memoryDelta);
      existing.maxMemoryDelta = Math.max(existing.maxMemoryDelta, memoryDelta);
      existing.averageMemoryDelta = existing.totalMemoryAllocated / existing.count;

      this.operationMetrics.set(operationName, existing);

      this.logInfo(
        `${operationName}: ${duration.toFixed(2)}ms, ${this.formatBytes(memoryDelta)} memory delta`
      );

      return { result, memoryDelta, duration };
    } catch (error) {
      this.takeSnapshot(`${operationName}_error`, { ...metadata, error: String(error) });
      throw error;
    }
  }

  /**
   * Analyze potential memory leaks
   */
  analyzeLeaks(): LeakAnalysis {
    if (this.snapshots.length < 3) {
      return {
        detected: false,
        severity: 'low',
        growthRate: 0,
        suspiciousOperations: [],
        recommendations: [],
        snapshots: this.snapshots,
      };
    }

    const recentSnapshots = this.snapshots.slice(-10); // Last 10 snapshots
    const lastSnapshot = recentSnapshots[recentSnapshots.length - 1];
    const firstSnapshot = recentSnapshots[0];

    if (!lastSnapshot || !firstSnapshot) {
      return {
        detected: false,
        severity: 'low',
        growthRate: 0,
        suspiciousOperations: [],
        recommendations: [],
        snapshots: this.snapshots,
      };
    }

    const timeSpan = lastSnapshot.timestamp - firstSnapshot.timestamp;

    if (timeSpan === 0) {
      return {
        detected: false,
        severity: 'low',
        growthRate: 0,
        suspiciousOperations: [],
        recommendations: [],
        snapshots: this.snapshots,
      };
    }

    const memoryGrowth = lastSnapshot.heapUsed - firstSnapshot.heapUsed;
    const growthRate = (memoryGrowth / timeSpan) * 1000; // bytes per second

    // Detect leak severity
    let detected = false;
    let severity: LeakAnalysis['severity'] = 'low';

    if (growthRate > this.options.leakThreshold) {
      detected = true;
      if (growthRate > this.options.leakThreshold * 5) {
        severity = 'critical';
      } else if (growthRate > this.options.leakThreshold * 3) {
        severity = 'high';
      } else if (growthRate > this.options.leakThreshold * 1.5) {
        severity = 'medium';
      }
    }

    // Find suspicious operations
    const suspiciousOperations = this.identifySuspiciousOperations();

    // Generate recommendations
    const recommendations = this.generateRecommendations(growthRate, suspiciousOperations);

    return {
      detected,
      severity,
      growthRate,
      suspiciousOperations,
      recommendations,
      snapshots: recentSnapshots,
    };
  }

  /**
   * Identify operations that may be causing memory leaks
   */
  private identifySuspiciousOperations(): string[] {
    const suspicious: string[] = [];

    for (const [operation, metrics] of this.operationMetrics) {
      // High average memory usage
      if (metrics.averageMemoryDelta > 10 * 1024 * 1024) {
        // 10MB average
        suspicious.push(
          `${operation}: High average memory usage (${this.formatBytes(metrics.averageMemoryDelta)})`
        );
      }

      // Memory growth without proper cleanup
      if (metrics.count > 5 && metrics.averageMemoryDelta > 1024 * 1024) {
        // 1MB average over 5 calls
        suspicious.push(`${operation}: Potential memory accumulation`);
      }

      // Very large single allocation
      if (metrics.maxMemoryDelta > 50 * 1024 * 1024) {
        // 50MB single allocation
        suspicious.push(
          `${operation}: Very large memory allocation (${this.formatBytes(metrics.maxMemoryDelta)})`
        );
      }
    }

    return suspicious;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(growthRate: number, suspiciousOperations: string[]): string[] {
    const recommendations: string[] = [];

    if (growthRate > this.options.leakThreshold) {
      recommendations.push('Memory leak detected - investigate resource cleanup in your code');

      if (suspiciousOperations.length > 0) {
        recommendations.push(
          `Focus on these operations: ${suspiciousOperations.slice(0, 3).join(', ')}`
        );
      }

      if (growthRate > this.options.leakThreshold * 5) {
        recommendations.push('CRITICAL: Memory growing very rapidly - immediate action required');
        recommendations.push('Consider restarting the process if growth continues');
      }

      recommendations.push('Enable garbage collection with --expose-gc for better measurements');
      recommendations.push('Review cache expiration policies');
      recommendations.push('Check for retained references to large objects');
      recommendations.push('Monitor subprocess memory usage in Python bridge');
    }

    // General performance recommendations
    if (this.operationMetrics.size > 0) {
      const avgMemoryPerOp =
        Array.from(this.operationMetrics.values()).reduce(
          (sum, m) => sum + m.averageMemoryDelta,
          0
        ) / this.operationMetrics.size;

      if (avgMemoryPerOp > 5 * 1024 * 1024) {
        // 5MB average
        recommendations.push('Consider optimizing data structures for lower memory usage');
        recommendations.push('Implement streaming for large data processing');
      }
    }

    return recommendations;
  }

  /**
   * Generate comprehensive memory report
   */
  generateReport(): MemoryReport {
    if (this.snapshots.length === 0) {
      throw new Error('No memory snapshots available for report');
    }

    const firstSnapshot = this.snapshots[0];
    const lastSnapshot = this.snapshots[this.snapshots.length - 1];

    if (!firstSnapshot || !lastSnapshot) {
      throw new Error('Invalid snapshot data for report generation');
    }

    const duration = lastSnapshot.timestamp - firstSnapshot.timestamp;

    const heapValues = this.snapshots.map(s => s.heapUsed);
    const peakMemory = Math.max(...heapValues);
    const averageMemory = heapValues.reduce((sum, val) => sum + val, 0) / heapValues.length;
    const memoryGrowth = lastSnapshot.heapUsed - firstSnapshot.heapUsed;

    // Calculate GC efficiency
    const gcEvents = this.snapshots.filter((s, i) => {
      const prevSnapshot = this.snapshots[i - 1];
      return i > 0 && prevSnapshot && s.gcCount > prevSnapshot.gcCount;
    });
    const gcEfficiency =
      gcEvents.length > 0
        ? gcEvents.reduce((sum, s) => {
            const prev = this.snapshots[this.snapshots.indexOf(s) - 1];
            const memoryReclaimed = prev ? prev.heapUsed - s.heapUsed : 0;
            return sum + Math.max(0, memoryReclaimed);
          }, 0) / gcEvents.length
        : 0;

    const summary = {
      duration,
      totalOperations: Array.from(this.operationMetrics.values()).reduce(
        (sum, m) => sum + m.count,
        0
      ),
      peakMemory,
      averageMemory,
      memoryGrowth,
      gcEfficiency,
    };

    const leakAnalysis = this.analyzeLeaks();

    // Generate overall recommendations
    const recommendations: string[] = [];
    if (summary.peakMemory > 500 * 1024 * 1024) {
      // 500MB peak
      recommendations.push(
        'High peak memory usage detected - consider memory optimization strategies'
      );
    }
    if (summary.memoryGrowth > 100 * 1024 * 1024) {
      // 100MB growth
      recommendations.push('Significant memory growth over session - review for potential leaks');
    }
    if (summary.gcEfficiency < 1024 * 1024) {
      // Less than 1MB reclaimed per GC
      recommendations.push(
        'Low GC efficiency - may indicate memory fragmentation or retained references'
      );
    }

    return {
      summary,
      leakAnalysis,
      operationMetrics: this.operationMetrics,
      recommendations: [...recommendations, ...leakAnalysis.recommendations],
    };
  }

  /**
   * Save memory report to file
   */
  saveReport(filePath: string): MemoryReport {
    const report = this.generateReport();

    const reportData = {
      timestamp: new Date().toISOString(),
      report,
      snapshots: this.snapshots,
    };

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caller controls report path
    writeFileSync(filePath, JSON.stringify(reportData, null, 2));
    this.logInfo(`Memory report saved to ${filePath}`);

    return report;
  }

  /**
   * Setup garbage collection tracking
   */
  private setupGCTracking(): void {
    if (typeof global.gc !== 'function') {
      console.warn('GC tracking unavailable - run with --expose-gc for better memory analysis');
      return;
    }

    // Hook into GC events if available
    try {
      if (process.versions.node >= '14.0.0') {
        const perfHooks = require('perf_hooks') as typeof import('node:perf_hooks');
        type GcPerformanceEntry = PerformanceEntry & { kind: number };
        const obs = new perfHooks.PerformanceObserver((list: PerformanceObserverEntryList) => {
          const entries = list.getEntries() as GcPerformanceEntry[];
          entries.forEach(entry => {
            if (entry.entryType === 'gc') {
              this.gcCount++;
              this.emit('gc', {
                type: entry.kind,
                duration: entry.duration,
                timestamp: Date.now(),
              });
            }
          });
        });
        obs.observe({ entryTypes: ['gc'] });
      }
    } catch (error) {
      console.warn('Advanced GC tracking unavailable:', error);
    }
  }

  /**
   * Format bytes for human readable output
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const size = bytes / Math.pow(k, i);
    const sign = bytes < 0 ? '-' : '+';
    const sizeLabel = i === 0 ? sizes[0] : i === 1 ? sizes[1] : i === 2 ? sizes[2] : sizes[3];
    return `${sign}${size.toFixed(1)} ${sizeLabel}`;
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all collected data
   */
  clear(): void {
    this.snapshots.length = 0;
    this.operationMetrics.clear();
    this.gcCount = 0;
    this.baselineSnapshot = undefined;
  }

  /**
   * Get current memory usage
   */
  getCurrentMemoryUsage(): MemorySnapshot {
    return this.takeSnapshot('current');
  }

  /**
   * Check if profiler has snapshots
   */
  hasSnapshots(): boolean {
    return this.snapshots.length > 0;
  }

  /**
   * Dispose profiler
   */
  dispose(): void {
    this.stopMonitoring();
    this.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance for global use
export const globalMemoryProfiler = new MemoryProfiler();

// Automatic profiling for process exit
process.on('exit', () => {
  if (globalMemoryProfiler.hasSnapshots()) {
    try {
      globalMemoryProfiler.saveReport('memory-profile-exit.json');
    } catch (error) {
      console.error('Failed to save exit memory report:', error);
    }
  }
});
