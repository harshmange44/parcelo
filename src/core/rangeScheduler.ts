/**
 * Production-ready distributed range scheduler with full reliability
 */

import { InMemoryScheduler } from './inMemoryScheduler';
import { RedisStore } from '../store/redisStore';
import { BullMQWorker } from '../worker/bullmqWorker';
import { JobMetrics, ConsoleLogger } from './metrics';
import {
  SchedulerOptions,
  RangeJobConfig,
  NodeStatus,
  JobStatus,
  SchedulerEvent,
  Logger,
  RangeJob,
} from '../types';
import { now } from '../utils/time';

export interface RangeSchedulerOptions extends SchedulerOptions {
  redisUrl?: string;
  staleNodeCheckIntervalMs?: number;
  staleNodeThresholdMs?: number;
  heartbeatIntervalMs?: number;
  enableMetrics?: boolean;
}

/**
 * Production-ready distributed range scheduler (RECOMMENDED for production)
 * 
 * Provides Redis persistence, BullMQ job processing, automatic retry with 
 * exponential backoff, stale node detection, heartbeat monitoring, and 
 * distributed coordination across multiple workers.
 * 
 * Requirements:
 * - Redis server
 * - BullMQ setup
 * 
 * For development/testing without external dependencies, see InMemoryScheduler
 */
export class RangeScheduler extends InMemoryScheduler {
  private redisStore: RedisStore;
  private bullWorkers: Map<string, BullMQWorker>;
  private jobMetrics: Map<string, JobMetrics>;
  private staleCheckInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervals: Map<string, NodeJS.Timeout>;
  private staleNodeThresholdMs: number;
  private heartbeatIntervalMs: number;
  private enableMetrics: boolean;
  protected logger: Logger;

  constructor(options: RangeSchedulerOptions = {}) {
    // Create Redis store
    const redisStore = new RedisStore({
      redisUrl: options.redisUrl,
      keyPrefix: 'rrs',
    });

    // Initialize parent with Redis store
    super({
      ...options,
      storage: redisStore,
    });

    this.redisStore = redisStore;
    this.bullWorkers = new Map();
    this.jobMetrics = new Map();
    this.heartbeatIntervals = new Map();
    this.staleNodeThresholdMs = options.staleNodeThresholdMs || 5 * 60 * 1000; // 5 minutes
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30 * 1000; // 30 seconds
    this.enableMetrics = options.enableMetrics !== false;
    this.logger = options.logger || new ConsoleLogger('RangeScheduler');

    // Start stale node detection
    if (options.staleNodeCheckIntervalMs) {
      this.startStaleNodeDetection(options.staleNodeCheckIntervalMs);
    }

    this.logger.info('Production scheduler initialized', {
      redisUrl: options.redisUrl || 'redis://localhost:6379',
      staleThresholdMs: this.staleNodeThresholdMs,
      heartbeatMs: this.heartbeatIntervalMs,
    });
  }

  /**
   * Create job with BullMQ integration
   */
  async createJob(config: RangeJobConfig): Promise<string> {
    const jobId = await super.createJob(config);

    // Create BullMQ worker for this job
    const bullWorker = new BullMQWorker({
      jobId,
      redisUrl: this.redisStore.getConnectionInfo().host,
      concurrency: config.maxConcurrency || this.defaultMaxConcurrency,
      logger: this.logger,
    });

    // Create metrics collector
    const metrics = new JobMetrics();
    this.jobMetrics.set(jobId, metrics);

    // Start worker with wrapped work function
    bullWorker.startWorker(async (range, context) => {
      // Record metrics
      if (this.enableMetrics) {
        metrics.recordNodeStart(context.nodeId);
      }

      try {
        await config.work(range, context);
        
        // Mark node as done
        await this.nodeStore.updateStatus(context.nodeId, NodeStatus.DONE);
        
        // Stop heartbeat
        this.stopHeartbeat(context.nodeId);
        
        // Record success
        if (this.enableMetrics) {
          const latency = metrics.recordNodeComplete(context.nodeId);
          
          await this.eventEmitter.emit(SchedulerEvent.NODE_COMPLETED, {
            jobId,
            nodeId: context.nodeId,
            durationMs: latency,
            attempt: context.attempt,  // Add attempt info
          });
        }
        
        // Update stats and check for completion
        await this.updateJobStats(jobId);
        await this.checkJobCompletion(jobId);
        
      } catch (error) {
        // Mark node as error or increment attempts for retry
        const node = await this.nodeStore.get(context.nodeId);
        if (node) {
          const maxAttempts = config.retry?.maxAttempts || 1;
          if (context.attempt + 1 >= maxAttempts) {
            // Final failure
            await this.nodeStore.updateStatus(
              context.nodeId,
              NodeStatus.ERROR,
              error instanceof Error ? error.message : String(error)
            );
            this.stopHeartbeat(context.nodeId);
          }
        }
        
        // Record failure
        if (this.enableMetrics) {
          metrics.recordNodeFailure(context.nodeId);
          
          await this.eventEmitter.emit(SchedulerEvent.NODE_FAILED, {
            jobId,
            nodeId: context.nodeId,
            error: error instanceof Error ? error.message : String(error),
            attempt: context.attempt,
          });
        }
        
        // Update stats and check for completion even on failure
        await this.updateJobStats(jobId);
        await this.checkJobCompletion(jobId);
        
        throw error; // Let BullMQ handle retry
      }
    });

    this.bullWorkers.set(jobId, bullWorker);

    this.logger.info('Job created with BullMQ worker', {
      jobId,
      maxConcurrency: config.maxConcurrency,
    });

    return jobId;
  }

  /**
   * Override to use BullMQ for execution
   */
  protected async executeLeafNode(
    jobId: string,
    nodeId: string,
    job: RangeJob
  ): Promise<void> {
    const node = await this.nodeStore.get(nodeId);
    if (!node) return;

    const bullWorker = this.bullWorkers.get(jobId);
    if (!bullWorker) {
      // Fallback to parent implementation
      await super['executeLeafNode'](jobId, nodeId, job);
      return;
    }

    // Mark as running
    await this.nodeStore.updateStatus(nodeId, NodeStatus.RUNNING);
    await this.eventEmitter.emit(SchedulerEvent.NODE_STARTED, {
      jobId,
      nodeId,
      attempt: node.attempts,
    });

    // Start heartbeat for this node
    this.startHeartbeat(nodeId);

    // Enqueue to BullMQ
    await bullWorker.enqueue(nodeId, node.range, job.config.retry);

    // Update stats
    await this.updateJobStats(jobId);
  }

  /**
   * Start heartbeat for a running node
   */
  private startHeartbeat(nodeId: string): void {
    // Clear existing heartbeat if any
    this.stopHeartbeat(nodeId);

    const interval = setInterval(async () => {
      try {
        await this.redisStore.heartbeat(nodeId);
      } catch (error) {
        this.logger.error('Heartbeat failed', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.heartbeatIntervalMs);

    this.heartbeatIntervals.set(nodeId, interval);
  }

  /**
   * Stop heartbeat for a node
   */
  private stopHeartbeat(nodeId: string): void {
    const interval = this.heartbeatIntervals.get(nodeId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(nodeId);
    }
  }

  /**
   * Start periodic stale node detection
   */
  private startStaleNodeDetection(intervalMs: number): void {
    this.staleCheckInterval = setInterval(async () => {
      try {
        await this.detectAndRecoverStaleNodes();
      } catch (error) {
        this.logger.error('Stale detection error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    this.logger.info('Stale node detection started', {
      intervalMs,
      thresholdMs: this.staleNodeThresholdMs,
    });
  }

  /**
   * Detect and recover stale nodes
   */
  private async detectAndRecoverStaleNodes(): Promise<void> {
    const jobs = await this.redisStore.getAllJobs();

    for (const job of jobs) {
      if (job.status !== JobStatus.RUNNING) continue;

      const staleNodes = await this.redisStore.findStaleNodes(
        job.id,
        this.staleNodeThresholdMs
      );

      for (const node of staleNodes) {
        const staleDuration = now() - (node.lastHeartbeat || node.startedAt || 0);
        
        this.logger.warn('Stale node detected', {
          jobId: job.id,
          nodeId: node.id,
          staleDurationMs: staleDuration,
          attempts: node.attempts,
        });

        await this.eventEmitter.emit(SchedulerEvent.NODE_STALE, {
          jobId: job.id,
          nodeId: node.id,
          staleDurationMs: staleDuration,
        });

        // Stop heartbeat
        this.stopHeartbeat(node.id);

        // Retry if attempts remain
        if (node.attempts < node.maxAttempts) {
          node.attempts++;
          node.status = NodeStatus.PENDING;
          node.retryHistory.push({
            attempt: node.attempts,
            error: 'Node stale - worker may have crashed',
            timestamp: now(),
          });

          await this.nodeStore.update(node.id, node);
          this.pendingQueue.enqueue(node.id, job.id, node.depth);

          if (this.enableMetrics) {
            const metrics = this.jobMetrics.get(job.id);
            metrics?.recordRetry();
          }

          await this.eventEmitter.emit(SchedulerEvent.NODE_RETRYING, {
            jobId: job.id,
            nodeId: node.id,
            attempt: node.attempts,
            nextRetryMs: 0,
          });
        } else {
          // Max attempts reached
          await this.nodeStore.updateStatus(
            node.id,
            NodeStatus.ERROR,
            'Node stale - max attempts reached'
          );
        }

        await this.updateJobStats(job.id);
      }
    }
  }

  /**
   * Override job completion check to handle partial failures
   */
  protected async checkJobCompletion(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) return;

    const stats = job.stats;
    const activeNodes = stats.pendingNodes + stats.runningNodes;

    if (activeNodes === 0) {
      // Stop all heartbeats for this job
      const allNodes = await this.nodeStore.getByJob(jobId);
      for (const node of allNodes) {
        this.stopHeartbeat(node.id);
      }

      // Check failure threshold
      const failureRate = stats.errorNodes / stats.totalNodes;
      const failureThreshold = (job.config.failureThreshold || 0) / 100;

      if (stats.errorNodes > 0 && failureRate > failureThreshold) {
        if (stats.doneNodes > 0) {
          // Partial failure
          await this.jobStore.updateStatus(jobId, JobStatus.PARTIALLY_FAILED);
          await this.eventEmitter.emit(SchedulerEvent.JOB_PARTIALLY_FAILED, {
            jobId,
            stats,
          });
        } else {
          // Complete failure
          await this.jobStore.updateStatus(jobId, JobStatus.FAILED);
          await this.eventEmitter.emit(SchedulerEvent.JOB_FAILED, {
            jobId,
            error: `Job completed with ${stats.errorNodes} errors (${(failureRate * 100).toFixed(1)}% failure rate)`,
          });
        }
      } else {
        // Success
        await this.jobStore.updateStatus(jobId, JobStatus.COMPLETED);
        
        // Emit enhanced stats with metrics
        let enhancedStats = stats;
        if (this.enableMetrics) {
          const metrics = this.jobMetrics.get(jobId);
          if (metrics) {
            enhancedStats = metrics.enhanceStats(stats);
            
            await this.eventEmitter.emit(SchedulerEvent.METRICS_UPDATED, {
              jobId,
              metrics: metrics.getMetrics(),
            });
          }
        }
        
        await this.eventEmitter.emit(SchedulerEvent.JOB_COMPLETED, {
          jobId,
          stats: enhancedStats,
        });
      }
    }
  }

  /**
   * Get performance metrics for a job
   */
  async getPerformanceMetrics(jobId: string) {
    const metrics = this.jobMetrics.get(jobId);
    return metrics ? metrics.getMetrics() : null;
  }

  /**
   * Get BullMQ queue metrics
   */
  async getBullMetrics(jobId: string) {
    const worker = this.bullWorkers.get(jobId);
    return worker ? await worker.getMetrics() : null;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down production scheduler...');

    // Stop stale detection
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }

    // Stop all heartbeats
    for (const [, interval] of this.heartbeatIntervals) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();

    // Close all BullMQ workers
    for (const [jobId, worker] of this.bullWorkers) {
      this.logger.info('Closing BullMQ worker', { jobId });
      await worker.close();
    }
    this.bullWorkers.clear();

    // Disconnect Redis
    await this.redisStore.disconnect();

    this.logger.info('Production scheduler shut down successfully');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    redis: boolean;
    workers: number;
    activeJobs: number;
  }> {
    const redisHealthy = await this.redisStore.ping();
    const jobs = await this.redisStore.getAllJobs();
    const activeJobs = jobs.filter(j => j.status === JobStatus.RUNNING).length;

    return {
      status: redisHealthy ? 'healthy' : 'unhealthy',
      redis: redisHealthy,
      workers: this.bullWorkers.size,
      activeJobs,
    };
  }
}

