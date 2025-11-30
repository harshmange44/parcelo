/**
 * In-memory scheduler - simple, no external dependencies
 * Perfect for development, testing, and single-process applications
 */

import {
  RangeJob,
  RangeJobConfig,
  JobStatus,
  NodeStatus,
  JobStats,
  RangeTreeSnapshot,
  SchedulerOptions,
  SchedulerEvent,
  EventListener,
  EventData,
  StorageAdapter,
} from '../types';
import { type RangeAdapter, getDefaultAdapter } from '../adapters/rangeAdapter';
import { InMemoryStore } from '../store/inMemoryStore';
import { JobStore } from '../store/jobStore';
import { NodeStore } from '../store/nodeStore';
import { RangeTree } from './rangeTree';
import { PendingQueue } from './pendingQueue';
import { EventEmitter } from './events';
import { WorkerPool } from '../worker/workerPool';
import { generateJobId } from '../utils/id';
import { now } from '../utils/time';

/**
 * In-memory range scheduler
 * 
 * Simple scheduler with no external dependencies (no Redis, no BullMQ).
 * Fast startup and perfect for development, testing, and single-process applications.
 * Supports generic range types (number, bigint, Date, custom types).
 * 
 * Limitations: No persistence (state lost on crash), no automatic retry, single process only.
 * 
 * For production use with reliability features, see RangeScheduler
 */
export class InMemoryScheduler<T = number> {
  private storage: StorageAdapter;
  protected jobStore: JobStore;
  protected nodeStore: NodeStore;
  protected eventEmitter: EventEmitter;
  private workerPool: WorkerPool<T>;
  protected pendingQueue: PendingQueue;
  private jobTrees: Map<string, RangeTree<T>>;
  protected defaultMaxConcurrency: number;
  private processingLoops: Map<string, boolean>; // jobId -> is processing

  constructor(options: SchedulerOptions = {}) {
    this.storage = options.storage || new InMemoryStore();
    this.jobStore = new JobStore(this.storage);
    this.nodeStore = new NodeStore(this.storage);
    this.eventEmitter = new EventEmitter();
    this.defaultMaxConcurrency = options.defaultMaxConcurrency || 10;
    this.workerPool = new WorkerPool<T>(this.defaultMaxConcurrency);
    this.pendingQueue = new PendingQueue();
    this.jobTrees = new Map();
    this.processingLoops = new Map();
  }

  /**
   * Create a new range job
   */
  async createJob(config: RangeJobConfig<T>): Promise<string> {
    // Get or infer range adapter
    const adapter: RangeAdapter<T> = config.rangeAdapter || getDefaultAdapter(config.range.start);

    // Validate range
    if (!RangeTree.isValidRange(config.range, adapter)) {
      throw new Error('Invalid range: start must be less than end');
    }

    const jobId = generateJobId();

    // Create range tree with adapter
    const rangeTree = new RangeTree<T>(
      this.nodeStore,
      config.maxRangeSize,
      adapter,
      config.shouldProcess
    );
    this.jobTrees.set(jobId, rangeTree);

    // Create root node
    const rootNode = await rangeTree.createRoot(jobId, config.range);

    // Create job
    const job: RangeJob<T> = {
      id: jobId,
      config,
      status: JobStatus.CREATED,
      rootNodeId: rootNode.id,
      stats: {
        totalNodes: 1,
        pendingNodes: 1,
        runningNodes: 0,
        doneNodes: 0,
        skippedNodes: 0,
        errorNodes: 0,
        rangeProcessed: 0,
        rangeSkipped: 0,
        rangeTotal: RangeTree.rangeSize(config.range, adapter),
        totalAttempts: 0,
        avgNodeLatencyMs: 0,
        throughputPerMinute: 0,
      },
      createdAt: now(),
    };

    await this.jobStore.create(job);

    // Emit event
    await this.eventEmitter.emit(SchedulerEvent.JOB_CREATED, { jobId, job });
    await this.eventEmitter.emit(SchedulerEvent.NODE_CREATED, {
      jobId,
      nodeId: rootNode.id,
      node: rootNode,
    });

    return jobId;
  }

  /**
   * Start processing a job
   */
  async startJob(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== JobStatus.CREATED && job.status !== JobStatus.PAUSED) {
      throw new Error(`Job ${jobId} is already ${job.status}`);
    }

    // Update job status
    await this.jobStore.updateStatus(jobId, JobStatus.RUNNING);

    // Emit event
    const event = job.status === JobStatus.PAUSED 
      ? SchedulerEvent.JOB_RESUMED 
      : SchedulerEvent.JOB_STARTED;
    await this.eventEmitter.emit(event, { jobId });

    // Start processing loop
    this.startProcessingLoop(jobId);
  }

  /**
   * Pause a job
   */
  async pauseJob(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== JobStatus.RUNNING) {
      throw new Error(`Job ${jobId} is not running`);
    }

    // Update job status
    await this.jobStore.updateStatus(jobId, JobStatus.PAUSED);

    // Stop processing loop
    this.processingLoops.set(jobId, false);

    // Emit event
    await this.eventEmitter.emit(SchedulerEvent.JOB_PAUSED, { jobId });
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Stop processing loop
    this.processingLoops.set(jobId, false);

    // Cancel all workers
    this.workerPool.cancelJob(jobId);

    // Remove pending items
    this.pendingQueue.removeByJob(jobId);

    // Update job status
    await this.jobStore.updateStatus(jobId, JobStatus.CANCELLED);

    // Emit event
    await this.eventEmitter.emit(SchedulerEvent.JOB_CANCELLED, { jobId });
  }

  /**
   * Get a job
   */
  async getJob(jobId: string): Promise<RangeJob | null> {
    return this.jobStore.get(jobId);
  }

  /**
   * Get job statistics
   */
  async getStats(jobId: string): Promise<JobStats | null> {
    const job = await this.jobStore.get(jobId);
    return job ? job.stats : null;
  }

  /**
   * Get a snapshot of the job's range tree
   */
  async getJobTreeSnapshot(jobId: string): Promise<RangeTreeSnapshot<T> | null> {
    const job = await this.jobStore.get(jobId);
    if (!job) {
      return null;
    }

    const rangeTree = this.jobTrees.get(jobId);
    if (!rangeTree) {
      return null;
    }

    const rootNode = await rangeTree.getSnapshot(job.rootNodeId);
    return {
      jobId,
      rootNode,
    };
  }

  /**
   * Register an event listener
   */
  on<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Register a one-time event listener
   */
  once<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    this.eventEmitter.once(event, listener);
  }

  /**
   * Remove an event listener
   */
  off<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    this.eventEmitter.off(event, listener);
  }

  // Private methods

  /**
   * Main processing loop for a job
   */
  private async startProcessingLoop(jobId: string): Promise<void> {
    this.processingLoops.set(jobId, true);

    // Add root node to pending queue if not already there
    const job = await this.jobStore.get(jobId);
    if (!job) return;

    const rootNode = await this.nodeStore.get(job.rootNodeId);
    if (rootNode && rootNode.status === NodeStatus.PENDING) {
      this.pendingQueue.enqueue(rootNode.id, jobId, rootNode.depth);
    }

    // Process loop
    while (this.processingLoops.get(jobId)) {
      try {
        await this.processNextBatch(jobId);
        
        // Check if job is complete
        await this.checkJobCompletion(jobId);

        // Small delay to prevent tight loop
        await this.sleep(10);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Connection is closed')) {
          // Connection was closed, exit loop gracefully
          break;
        }
        console.error(`Error in processing loop for job ${jobId}:`, error);
        await this.handleJobError(jobId, error);
        break;
      }
    }

    this.processingLoops.delete(jobId);
  }

  /**
   * Process the next batch of nodes
   */
  private async processNextBatch(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job || job.status !== JobStatus.RUNNING) {
      return;
    }

    const rangeTree = this.jobTrees.get(jobId);
    if (!rangeTree) {
      return;
    }

    // Process nodes while we have capacity
    while (this.workerPool.hasCapacity() && !this.pendingQueue.isEmpty()) {
      const item = this.pendingQueue.peek();
      if (!item || item.jobId !== jobId) {
        // Get items for this job
        const jobItems = this.pendingQueue.getByJob(jobId);
        if (jobItems.length === 0) {
          break;
        }
        // Process first item for this job
        const firstItem = jobItems[0];
        this.pendingQueue.remove(firstItem.nodeId);
        await this.processNode(jobId, firstItem.nodeId, rangeTree);
      } else {
        this.pendingQueue.dequeue();
        await this.processNode(jobId, item.nodeId, rangeTree);
      }
    }
  }

  /**
   * Process a single node
   */
  private async processNode(jobId: string, nodeId: string, rangeTree: RangeTree<T>): Promise<void> {
    const node = await this.nodeStore.get(nodeId);
    if (!node || node.status !== NodeStatus.PENDING) {
      return;
    }

    const job = await this.jobStore.get(jobId);
    if (!job) return;

    // Check if node should be processed
    const shouldProcess = await rangeTree.shouldProcessNode(node);
    if (!shouldProcess) {
      // Skip this node and its subtree
      await rangeTree.skipSubtree(nodeId);
      await this.eventEmitter.emit(SchedulerEvent.NODE_SKIPPED, { jobId, nodeId });
      await this.updateJobStats(jobId);
      return;
    }

    // If node is a leaf, execute work
    if (node.isLeaf) {
      await this.executeLeafNode(jobId, nodeId, job);
      return;
    }

    // Otherwise, split the node
    await this.splitNode(jobId, nodeId, rangeTree);
  }

  /**
   * Split a node and enqueue children
   */
  private async splitNode(jobId: string, nodeId: string, rangeTree: RangeTree<T>): Promise<void> {
    const result = await rangeTree.split(nodeId);
    if (!result) {
      return;
    }

    const { left, right } = result;

    // Emit events
    await this.eventEmitter.emit(SchedulerEvent.NODE_SPLIT, {
      jobId,
      nodeId,
      leftId: left.id,
      rightId: right.id,
    });
    await this.eventEmitter.emit(SchedulerEvent.NODE_CREATED, {
      jobId,
      nodeId: left.id,
      node: left,
    });
    await this.eventEmitter.emit(SchedulerEvent.NODE_CREATED, {
      jobId,
      nodeId: right.id,
      node: right,
    });

    // Mark parent as done (it's now split)
    await this.nodeStore.updateStatus(nodeId, NodeStatus.DONE);

    // Enqueue children
    this.pendingQueue.enqueue(left.id, jobId, left.depth);
    this.pendingQueue.enqueue(right.id, jobId, right.depth);

    await this.updateJobStats(jobId);
  }

  /**
   * Execute work on a leaf node
   */
  protected async executeLeafNode(jobId: string, nodeId: string, job: RangeJob<T>): Promise<void> {
    const node = await this.nodeStore.get(nodeId);
    if (!node) return;

    // Mark as running
    await this.nodeStore.updateStatus(nodeId, NodeStatus.RUNNING);
    await this.eventEmitter.emit(SchedulerEvent.NODE_STARTED, { 
      jobId, 
      nodeId, 
      attempt: node.attempts || 0 
    });
    await this.updateJobStats(jobId);

    try {
      // Execute work in worker pool
      await this.workerPool.execute(nodeId, jobId, node.range, job.config.work);

      // Mark as done
      await this.nodeStore.updateStatus(nodeId, NodeStatus.DONE);
      await this.eventEmitter.emit(SchedulerEvent.NODE_COMPLETED, { 
        jobId, 
        nodeId, 
        durationMs: now() - (node.startedAt || now()) 
      });
      await this.updateJobStats(jobId);
    } catch (error) {
      // Mark as error
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.nodeStore.updateStatus(nodeId, NodeStatus.ERROR, errorMsg);
      await this.eventEmitter.emit(SchedulerEvent.NODE_FAILED, {
        jobId,
        nodeId,
        error: errorMsg,
        attempt: node.attempts || 1,
      });
      await this.updateJobStats(jobId);
    }
  }

  /**
   * Update job statistics
   */
  protected async updateJobStats(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) return;

    const rangeTree = this.jobTrees.get(jobId);
    if (!rangeTree) return;

    const allNodes = await this.nodeStore.getByJob(jobId);
    
    const stats: JobStats = {
      totalNodes: allNodes.length,
      pendingNodes: allNodes.filter(n => n.status === NodeStatus.PENDING).length,
      runningNodes: allNodes.filter(n => n.status === NodeStatus.RUNNING).length,
      doneNodes: allNodes.filter(n => n.status === NodeStatus.DONE).length,
      skippedNodes: allNodes.filter(n => n.status === NodeStatus.SKIPPED).length,
      errorNodes: allNodes.filter(n => n.status === NodeStatus.ERROR).length,
      rangeProcessed: allNodes
        .filter(n => n.status === NodeStatus.DONE && n.isLeaf)
        .reduce((sum, n) => sum + rangeTree.rangeSize(n.range as any), 0),
      rangeSkipped: allNodes
        .filter(n => n.status === NodeStatus.SKIPPED && n.isLeaf)
        .reduce((sum, n) => sum + rangeTree.rangeSize(n.range as any), 0),
      rangeTotal: rangeTree.rangeSize(job.config.range as any),
      totalAttempts: 0,
      avgNodeLatencyMs: 0,
      throughputPerMinute: 0,
    };

    await this.jobStore.updateStats(jobId, stats);
    await this.eventEmitter.emit(SchedulerEvent.STATS_UPDATED, { jobId, stats });
  }

  /**
   * Check if a job is complete
   */
  protected async checkJobCompletion(jobId: string): Promise<void> {
    const job = await this.jobStore.get(jobId);
    if (!job) return;

    const stats = job.stats;
    const activeNodes = stats.pendingNodes + stats.runningNodes;

    if (activeNodes === 0) {
      // Job is complete
      if (stats.errorNodes > 0) {
        await this.jobStore.updateStatus(jobId, JobStatus.FAILED);
        await this.eventEmitter.emit(SchedulerEvent.JOB_FAILED, {
          jobId,
          error: `Job completed with ${stats.errorNodes} errors`,
        });
      } else {
        await this.jobStore.updateStatus(jobId, JobStatus.COMPLETED);
        await this.eventEmitter.emit(SchedulerEvent.JOB_COMPLETED, { jobId, stats });
      }
    }
  }

  /**
   * Handle job error
   */
  private async handleJobError(jobId: string, error: unknown): Promise<void> {
    if (error instanceof Error && error.message.includes('Connection is closed')) {
      return;
    }
    
    try {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.jobStore.updateStatus(jobId, JobStatus.FAILED);
      await this.eventEmitter.emit(SchedulerEvent.JOB_FAILED, { jobId, error: errorMsg });
    } catch (updateError) {
      // Ignore errors if connection is already closed
      if (!(updateError instanceof Error && updateError.message.includes('Connection is closed'))) {
        throw updateError;
      }
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

