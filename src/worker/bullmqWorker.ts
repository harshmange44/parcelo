/**
 * BullMQ integration for reliable distributed job processing
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { WorkCallback, Range, WorkContext, Logger, RetryConfig } from '../types';
import { EventEmitter } from 'eventemitter3';

export interface BullMQWorkerOptions {
  jobId: string;
  redisUrl?: string;
  concurrency?: number;
  logger?: Logger;
}

export interface RangeJobData<T = number> {
  nodeId: string;
  jobId: string;
  range: Range<T>;
  attempt: number;
}

/**
 * BullMQ-based worker pool with automatic retry and distributed processing
 * @template T The type of values in the range
 */
export class BullMQWorker<T = number> extends EventEmitter {
  private queue: Queue<RangeJobData<T>>;
  private worker: Worker<RangeJobData<T>> | null = null;
  private queueEvents: QueueEvents;
  private jobId: string;
  private logger?: Logger;
  private concurrency: number;

  constructor(options: BullMQWorkerOptions) {
    super();
    this.jobId = options.jobId;
    this.logger = options.logger;
    this.concurrency = options.concurrency || 5;

    const connection = this.parseRedisUrl(options.redisUrl);

    // Create queue - BullMQ queue names cannot contain colons
    const sanitizedJobId = this.jobId.replace(/:/g, '-');
    const queueName = `rrs-job-${sanitizedJobId}`;
    
    this.queue = new Queue<RangeJobData<T>>(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          count: 100, // Keep last 100 completed
          age: 3600, // Keep for 1 hour
        },
        removeOnFail: false, // Keep failed jobs for inspection
      },
    });

    // Create queue events for monitoring
    this.queueEvents = new QueueEvents(queueName, { connection });
    
    this.setupQueueEvents();
  }

  private parseRedisUrl(url?: string): { host: string; port: number } {
    if (!url) {
      return { host: 'localhost', port: 6379 };
    }

    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port || '6379'),
      };
    } catch {
      return { host: 'localhost', port: 6379 };
    }
  }

  private setupQueueEvents(): void {
    this.queueEvents.on('completed', ({ jobId }: { jobId: string }) => {
      this.emit('job:completed', { jobId });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
      this.emit('job:failed', { jobId, error: failedReason });
    });

    this.queueEvents.on('progress', ({ jobId, data }: { jobId: string; data: unknown }) => {
      this.emit('job:progress', { jobId, progress: data });
    });
  }

  /**
   * Add a range to the queue for processing
   */
  async enqueue(
    nodeId: string,
    range: Range<T>,
    retry?: RetryConfig
  ): Promise<void> {
    const maxAttempts = retry?.maxAttempts || 3;
    const backoffType = retry?.backoffType || 'exponential';
    
    let backoff: any;
    
    if (typeof retry?.backoffMs === 'function') {
      // Custom backoff function
      backoff = {
        type: 'custom',
      };
    } else {
      const delay = retry?.backoffMs || 1000;
      backoff = {
        type: backoffType,
        delay,
      };
    }

    await this.queue.add(
      'process-range',
      {
        nodeId,
        jobId: this.jobId,
        range,
        attempt: 0,
      },
      {
        attempts: maxAttempts,
        backoff,
        // BullMQ job IDs cannot contain colons
        jobId: `${this.jobId.replace(/:/g, '-')}-${nodeId}`,
      }
    );

    this.logger?.debug('Enqueued range for processing', {
      nodeId,
      range,
      maxAttempts,
    });
  }

  /**
   * Start the worker with the given work callback
   */
  startWorker(work: WorkCallback<T>): void {
    if (this.worker) {
      throw new Error('Worker already started');
    }

    const connection = this.parseRedisUrl();

    // Use the same sanitized queue name
    const sanitizedJobId = this.jobId.replace(/:/g, '-');
    const queueName = `rrs-job-${sanitizedJobId}`;

    this.worker = new Worker<RangeJobData<T>>(
      queueName,
      async (job: Job<RangeJobData<T>>) => {
        const { nodeId, range, jobId } = job.data;
        const attempt = job.attemptsMade;

        this.logger?.info('Processing range', {
          nodeId,
          range,
          attempt,
          jobId: job.id,
        });

        const controller = new AbortController();
        
        // Note: BullMQ handles cancellation internally
        // We could use job.updateProgress() to check for cancellation if needed

        const context: WorkContext = {
          jobId,
          nodeId,
          signal: controller.signal,
          attempt,
          logger: this.logger,
        };

        try {
          await work(range, context);
          
          this.logger?.info('Range processed successfully', {
            nodeId,
            range,
            attempt,
          });
        } catch (error) {
          this.logger?.error('Range processing failed', {
            nodeId,
            range,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error; // Let BullMQ handle retry
        }
      },
      {
        connection,
        concurrency: this.concurrency,
        autorun: true,
      }
    );

    // Worker event handlers
    this.worker.on('completed', (job: Job<RangeJobData<T>> | undefined) => {
      if (job) {
        this.logger?.debug('Worker completed job', { jobId: job.id });
      }
    });

    this.worker.on('failed', (job: Job<RangeJobData<T>> | undefined, error: Error) => {
      if (job) {
        this.logger?.error('Worker job failed', {
          jobId: job.id,
          attempt: job.attemptsMade,
          error: error.message,
        });
      }
    });

    this.worker.on('error', (error: Error) => {
      this.logger?.error('Worker error', { error: error.message });
    });

    this.logger?.info('Worker started', {
      concurrency: this.concurrency,
      jobId: this.jobId,
    });
  }

  /**
   * Stop the worker gracefully
   */
  async stopWorker(): Promise<void> {
    if (this.worker) {
      this.logger?.info('Stopping worker', { jobId: this.jobId });
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Get queue metrics
   */
  async getMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get failed jobs for inspection
   */
  async getFailedJobs(limit: number = 10): Promise<Job<RangeJobData<T>>[]> {
    return this.queue.getFailed(0, limit - 1);
  }

  /**
   * Retry a failed job
   */
  async retryFailedJob(bullJobId: string): Promise<void> {
    const job = await this.queue.getJob(bullJobId);
    if (job && await job.isFailed()) {
      await job.retry();
      this.logger?.info('Retrying failed job', { jobId: bullJobId });
    }
  }

  /**
   * Retry all failed jobs
   */
  async retryAllFailedJobs(): Promise<number> {
    const failed = await this.queue.getFailed();
    let retried = 0;

    for (const job of failed) {
      try {
        await job.retry();
        retried++;
      } catch (error) {
        this.logger?.error('Failed to retry job', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger?.info(`Retried ${retried} failed jobs`);
    return retried;
  }

  /**
   * Clean up old jobs
   */
  async cleanup(olderThanMs: number = 24 * 3600 * 1000): Promise<void> {
    await this.queue.clean(olderThanMs, 1000, 'completed');
    await this.queue.clean(olderThanMs, 1000, 'failed');
    this.logger?.info('Cleaned up old jobs', { olderThanMs });
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    this.logger?.info('Queue paused', { jobId: this.jobId });
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    this.logger?.info('Queue resumed', { jobId: this.jobId });
  }

  /**
   * Close and clean up
   */
  async close(): Promise<void> {
    await this.stopWorker();
    await this.queueEvents.close();
    await this.queue.close();
    this.logger?.info('BullMQ worker closed', { jobId: this.jobId });
  }

  /**
   * Obliterate - completely remove queue and all data
   */
  async obliterate(): Promise<void> {
    await this.queue.obliterate({ force: true });
    this.logger?.warn('Queue obliterated', { jobId: this.jobId });
  }
}

