/**
 * Redis-backed storage with atomic operations for distributed systems
 */

import Redis from 'ioredis';
import {
  RangeJob,
  RangeNode,
  NodeStatus,
  StorageAdapter,
} from '../types';

export interface RedisStoreOptions {
  redis?: Redis;
  redisUrl?: string;
  keyPrefix?: string;
}

/**
 * Production-grade Redis storage with atomic operations
 */
export class RedisStore implements StorageAdapter {
  private redis: Redis;
  private keyPrefix: string;
  private ownRedis: boolean;

  constructor(options: RedisStoreOptions = {}) {
    if (options.redis) {
      this.redis = options.redis;
      this.ownRedis = false;
    } else {
      this.redis = new Redis(options.redisUrl || 'redis://localhost:6379');
      this.ownRedis = true;
    }
    this.keyPrefix = options.keyPrefix || 'rrs'; // recursive-range-scheduler
  }

  private jobKey(jobId: string): string {
    return `${this.keyPrefix}:job:${jobId}`;
  }

  private nodeKey(nodeId: string): string {
    return `${this.keyPrefix}:node:${nodeId}`;
  }

  private jobNodesKey(jobId: string): string {
    return `${this.keyPrefix}:job:${jobId}:nodes`;
  }

  private jobStatusKey(jobId: string, status: NodeStatus): string {
    return `${this.keyPrefix}:job:${jobId}:status:${status}`;
  }

  private allJobsKey(): string {
    return `${this.keyPrefix}:jobs:all`;
  }

  // Job operations
  async saveJob(job: RangeJob): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.set(this.jobKey(job.id), JSON.stringify(job));
    pipeline.sadd(this.allJobsKey(), job.id);
    await pipeline.exec();
  }

  async getJob(jobId: string): Promise<RangeJob | null> {
    const data = await this.redis.get(this.jobKey(jobId));
    return data ? JSON.parse(data) : null;
  }

  async updateJob(jobId: string, updates: Partial<RangeJob>): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    Object.assign(job, updates, { updatedAt: Date.now() });
    await this.redis.set(this.jobKey(jobId), JSON.stringify(job));
  }

  async deleteJob(jobId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    // Delete job
    pipeline.del(this.jobKey(jobId));
    pipeline.srem(this.allJobsKey(), jobId);
    
    // Get all node IDs
    const nodeIds = await this.redis.smembers(this.jobNodesKey(jobId));
    
    // Delete all nodes
    for (const nodeId of nodeIds) {
      pipeline.del(this.nodeKey(nodeId));
    }
    
    // Delete indices
    pipeline.del(this.jobNodesKey(jobId));
    for (const status of Object.values(NodeStatus)) {
      pipeline.del(this.jobStatusKey(jobId, status as NodeStatus));
    }
    
    await pipeline.exec();
  }

  async getAllJobs(): Promise<RangeJob[]> {
    const jobIds = await this.redis.smembers(this.allJobsKey());
    const jobs: RangeJob[] = [];
    
    for (const jobId of jobIds) {
      const job = await this.getJob(jobId);
      if (job) jobs.push(job);
    }
    
    return jobs;
  }

  // Node operations
  async saveNode(node: RangeNode): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    // Store node data
    pipeline.set(this.nodeKey(node.id), JSON.stringify(node));
    
    // Index by job
    pipeline.sadd(this.jobNodesKey(node.jobId), node.id);
    
    // Index by status (sorted by depth for priority - deeper nodes first)
    pipeline.zadd(
      this.jobStatusKey(node.jobId, node.status),
      -node.depth, // Negative for reverse order
      node.id
    );
    
    await pipeline.exec();
  }

  async getNode(nodeId: string): Promise<RangeNode | null> {
    const data = await this.redis.get(this.nodeKey(nodeId));
    return data ? JSON.parse(data) : null;
  }

  async updateNode(nodeId: string, updates: Partial<RangeNode>): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }
    
    const oldStatus = node.status;
    Object.assign(node, updates, { updatedAt: Date.now() });
    
    const pipeline = this.redis.pipeline();
    
    // Update node data
    pipeline.set(this.nodeKey(nodeId), JSON.stringify(node));
    
    // If status changed, update status index
    if (updates.status && updates.status !== oldStatus) {
      pipeline.zrem(this.jobStatusKey(node.jobId, oldStatus), nodeId);
      pipeline.zadd(
        this.jobStatusKey(node.jobId, updates.status),
        -node.depth,
        nodeId
      );
    }
    
    await pipeline.exec();
  }

  async deleteNode(nodeId: string): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) return;
    
    const pipeline = this.redis.pipeline();
    pipeline.del(this.nodeKey(nodeId));
    pipeline.srem(this.jobNodesKey(node.jobId), nodeId);
    pipeline.zrem(this.jobStatusKey(node.jobId, node.status), nodeId);
    await pipeline.exec();
  }

  async getNodesByJob(jobId: string): Promise<RangeNode[]> {
    const nodeIds = await this.redis.smembers(this.jobNodesKey(jobId));
    const nodes: RangeNode[] = [];
    
    for (const nodeId of nodeIds) {
      const node = await this.getNode(nodeId);
      if (node) nodes.push(node);
    }
    
    return nodes;
  }

  async getNodesByStatus(jobId: string, status: NodeStatus): Promise<RangeNode[]> {
    // Get nodes sorted by priority (depth descending)
    const nodeIds = await this.redis.zrange(
      this.jobStatusKey(jobId, status),
      0,
      -1
    );
    
    const nodes: RangeNode[] = [];
    for (const nodeId of nodeIds) {
      const node = await this.getNode(nodeId);
      if (node) nodes.push(node);
    }
    
    return nodes;
  }

  // Batch operations
  async saveNodes(nodes: RangeNode[]): Promise<void> {
    if (nodes.length === 0) return;
    
    const pipeline = this.redis.pipeline();
    
    for (const node of nodes) {
      pipeline.set(this.nodeKey(node.id), JSON.stringify(node));
      pipeline.sadd(this.jobNodesKey(node.jobId), node.id);
      pipeline.zadd(
        this.jobStatusKey(node.jobId, node.status),
        -node.depth,
        node.id
      );
    }
    
    await pipeline.exec();
  }

  async updateNodes(updates: Array<{ nodeId: string; updates: Partial<RangeNode> }>): Promise<void> {
    for (const { nodeId, updates: nodeUpdates } of updates) {
      await this.updateNode(nodeId, nodeUpdates);
    }
  }

  /**
   * Atomically claim the next pending node for processing
   * This prevents race conditions in distributed systems
   */
  async claimNextPendingNode(jobId: string): Promise<RangeNode | null> {
    const statusKey = this.jobStatusKey(jobId, NodeStatus.PENDING);
    
    // Atomic pop with highest priority (deepest node)
    const result = await this.redis.zpopmin(statusKey);
    
    if (!result || result.length === 0) {
      return null;
    }
    
    const nodeId = result[0];
    const node = await this.getNode(nodeId);
    
    if (!node) {
      return null;
    }
    
    // Mark as running
    node.status = NodeStatus.RUNNING;
    node.startedAt = Date.now();
    node.lastHeartbeat = Date.now();
    node.updatedAt = Date.now();
    
    // Update in Redis
    const pipeline = this.redis.pipeline();
    pipeline.set(this.nodeKey(nodeId), JSON.stringify(node));
    pipeline.zadd(
      this.jobStatusKey(jobId, NodeStatus.RUNNING),
      -node.depth,
      nodeId
    );
    await pipeline.exec();
    
    return node;
  }

  /**
   * Find nodes that have been running too long (stale/crashed workers)
   */
  async findStaleNodes(jobId: string, staleThresholdMs: number): Promise<RangeNode[]> {
    const runningNodes = await this.getNodesByStatus(jobId, NodeStatus.RUNNING);
    const now = Date.now();
    const staleNodes: RangeNode[] = [];
    
    for (const node of runningNodes) {
      const lastCheck = node.lastHeartbeat || node.startedAt;
      if (lastCheck && (now - lastCheck) > staleThresholdMs) {
        staleNodes.push(node);
      }
    }
    
    return staleNodes;
  }

  /**
   * Update heartbeat for a running node
   */
  async heartbeat(nodeId: string): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node) return;
    
    node.lastHeartbeat = Date.now();
    node.updatedAt = Date.now();
    await this.redis.set(this.nodeKey(nodeId), JSON.stringify(node));
  }

  // Cleanup
  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ownRedis) {
      await this.redis.quit();
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): { host: string; port: number; status: string } {
    return {
      host: this.redis.options.host || 'localhost',
      port: this.redis.options.port || 6379,
      status: this.redis.status,
    };
  }
}

