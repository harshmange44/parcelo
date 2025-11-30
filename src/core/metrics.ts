/**
 * Metrics and observability for performance monitoring
 */

import { PerformanceMetrics, JobStats } from '../types';

/**
 * Tracks latency samples and calculates percentiles
 */
class LatencyTracker {
  private samples: number[] = [];
  private maxSamples: number;

  constructor(maxSamples: number = 1000) {
    this.maxSamples = maxSamples;
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    
    // Keep only recent samples
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getPercentile(p: number): number {
    if (this.samples.length === 0) return 0;
    
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getAverage(): number {
    if (this.samples.length === 0) return 0;
    
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return sum / this.samples.length;
  }

  clear(): void {
    this.samples = [];
  }

  getSampleCount(): number {
    return this.samples.length;
  }
}

/**
 * Metrics collector for job performance
 */
export class MetricsCollector {
  private latencyTracker: LatencyTracker;
  private successCount: number = 0;
  private failureCount: number = 0;
  private retryCount: number = 0;
  private startTime: number;
  private lastUpdateTime: number;
  private throughputSamples: number[] = [];

  constructor() {
    this.latencyTracker = new LatencyTracker(1000);
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
  }

  /**
   * Record a successful operation
   */
  recordSuccess(latencyMs: number): void {
    this.successCount++;
    this.latencyTracker.record(latencyMs);
    this.updateThroughput();
  }

  /**
   * Record a failed operation
   */
  recordFailure(latencyMs: number): void {
    this.failureCount++;
    this.latencyTracker.record(latencyMs);
    this.updateThroughput();
  }

  /**
   * Record a retry
   */
  recordRetry(): void {
    this.retryCount++;
  }

  /**
   * Update throughput calculation
   */
  private updateThroughput(): void {
    const now = Date.now();
    const elapsed = (now - this.lastUpdateTime) / 1000; // seconds
    
    if (elapsed >= 1) {
      const opsInLastSecond = this.successCount + this.failureCount;
      this.throughputSamples.push(opsInLastSecond);
      
      // Keep only last 60 seconds
      if (this.throughputSamples.length > 60) {
        this.throughputSamples.shift();
      }
      
      this.lastUpdateTime = now;
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const totalOps = this.successCount + this.failureCount;
    const successRate = totalOps > 0 ? this.successCount / totalOps : 1;
    const retryRate = totalOps > 0 ? this.retryCount / totalOps : 0;

    // Calculate throughput (ops per second)
    const avgThroughput = this.throughputSamples.length > 0
      ? this.throughputSamples.reduce((a, b) => a + b, 0) / this.throughputSamples.length
      : 0;

    return {
      throughputPerSecond: avgThroughput,
      avgLatencyMs: this.latencyTracker.getAverage(),
      p50LatencyMs: this.latencyTracker.getPercentile(50),
      p95LatencyMs: this.latencyTracker.getPercentile(95),
      p99LatencyMs: this.latencyTracker.getPercentile(99),
      successRate,
      retryRate,
    };
  }

  /**
   * Get counts
   */
  getCounts(): {
    success: number;
    failure: number;
    retry: number;
    total: number;
  } {
    return {
      success: this.successCount,
      failure: this.failureCount,
      retry: this.retryCount,
      total: this.successCount + this.failureCount,
    };
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.successCount = 0;
    this.failureCount = 0;
    this.retryCount = 0;
    this.latencyTracker.clear();
    this.throughputSamples = [];
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
  }

  /**
   * Get elapsed time
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Enhanced job statistics with performance metrics
 */
export class JobMetrics {
  private metrics: MetricsCollector;
  private nodeLatencies: Map<string, number> = new Map();

  constructor() {
    this.metrics = new MetricsCollector();
  }

  /**
   * Record node start
   */
  recordNodeStart(nodeId: string): void {
    this.nodeLatencies.set(nodeId, Date.now());
  }

  /**
   * Record node completion
   */
  recordNodeComplete(nodeId: string): number {
    const startTime = this.nodeLatencies.get(nodeId);
    if (!startTime) return 0;

    const latency = Date.now() - startTime;
    this.nodeLatencies.delete(nodeId);
    this.metrics.recordSuccess(latency);
    
    return latency;
  }

  /**
   * Record node failure
   */
  recordNodeFailure(nodeId: string): number {
    const startTime = this.nodeLatencies.get(nodeId);
    if (!startTime) return 0;

    const latency = Date.now() - startTime;
    this.nodeLatencies.delete(nodeId);
    this.metrics.recordFailure(latency);
    
    return latency;
  }

  /**
   * Record retry
   */
  recordRetry(): void {
    this.metrics.recordRetry();
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return this.metrics.getMetrics();
  }

  /**
   * Get counts
   */
  getCounts() {
    return this.metrics.getCounts();
  }

  /**
   * Enhance job stats with performance metrics
   */
  enhanceStats(stats: JobStats): JobStats {
    const metrics = this.getMetrics();
    const counts = this.getCounts();

    return {
      ...stats,
      totalAttempts: counts.total + counts.retry,
      avgNodeLatencyMs: metrics.avgLatencyMs,
      p95NodeLatencyMs: metrics.p95LatencyMs,
      throughputPerMinute: metrics.throughputPerSecond * 60,
      startTime: stats.startTime,
      endTime: stats.endTime,
    };
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics.reset();
    this.nodeLatencies.clear();
  }
}

/**
 * Simple console logger implementation
 */
export class ConsoleLogger {
  constructor(private context?: string) {}

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[INFO]${this.context ? ` [${this.context}]` : ''} ${message}`, meta || '');
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN]${this.context ? ` [${this.context}]` : ''} ${message}`, meta || '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[ERROR]${this.context ? ` [${this.context}]` : ''} ${message}`, meta || '');
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG]${this.context ? ` [${this.context}]` : ''} ${message}`, meta || '');
    }
  }
}

