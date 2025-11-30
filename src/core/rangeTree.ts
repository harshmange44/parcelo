/**
 * Range tree with recursive binary splitting
 */

import {
  Range,
  RangeNode,
  RangeNodeSnapshot,
  NodeStatus,
  ProcessFlags,
  ShouldProcessCallback,
} from '../types';
import { RangeAdapter } from '../adapters/rangeAdapter';
import { NodeStore } from '../store/nodeStore';
import { generateNodeId } from '../utils/id';
import { now } from '../utils/time';

/**
 * Manages the range tree structure and splitting logic
 * @template T The type of values in the range
 */
export class RangeTree<T = number> {
  constructor(
    private nodeStore: NodeStore,
    private maxRangeSize: number,
    private adapter: RangeAdapter<T>,
    private shouldProcess?: ShouldProcessCallback<T>
  ) {}

  /**
   * Create the root node for a job
   */
  async createRoot(jobId: string, range: Range<T>): Promise<RangeNode<T>> {
    const rootNode: RangeNode<T> = {
      id: generateNodeId(),
      jobId,
      range,
      status: NodeStatus.PENDING,
      depth: 0,
      path: [],
      parentId: null,
      leftChildId: null,
      rightChildId: null,
      isLeaf: this.isLeafSize(range),
      createdAt: now(),
      updatedAt: now(),
      attempts: 0,
      maxAttempts: 3,
      retryHistory: [],
    };

    await this.nodeStore.create(rootNode);
    return rootNode;
  }

  /**
   * Split a node into two child nodes using the adapter
   */
  async split(nodeId: string): Promise<{ left: RangeNode<T>; right: RangeNode<T> } | null> {
    const node = await this.nodeStore.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    if (node.leftChildId || node.rightChildId) {
      // Already split
      return null;
    }

    if (this.isLeafSize(node.range)) {
      // Cannot split further
      return null;
    }

    // Calculate midpoint using adapter
    const { start, end } = node.range;
    const mid = this.adapter.midpoint(start, end);

    // Create left child [start, mid]
    const leftRange: Range<T> = { start, end: mid };
    const leftNode: RangeNode<T> = {
      id: generateNodeId(),
      jobId: node.jobId,
      range: leftRange,
      status: NodeStatus.PENDING,
      depth: node.depth + 1,
      path: [...node.path, 0],
      parentId: node.id,
      leftChildId: null,
      rightChildId: null,
      isLeaf: this.isLeafSize(leftRange),
      createdAt: now(),
      updatedAt: now(),
      attempts: 0,
      maxAttempts: node.maxAttempts,
      retryHistory: [],
    };

    // Create right child [mid, end]
    const rightRange: Range<T> = { start: mid, end };
    const rightNode: RangeNode<T> = {
      id: generateNodeId(),
      jobId: node.jobId,
      range: rightRange,
      status: NodeStatus.PENDING,
      depth: node.depth + 1,
      path: [...node.path, 1],
      parentId: node.id,
      leftChildId: null,
      rightChildId: null,
      isLeaf: this.isLeafSize(rightRange),
      createdAt: now(),
      updatedAt: now(),
      attempts: 0,
      maxAttempts: node.maxAttempts,
      retryHistory: [],
    };

    // Save children
    await this.nodeStore.createMany([leftNode, rightNode]);

    // Update parent
    await this.nodeStore.setChildren(node.id, leftNode.id, rightNode.id);

    return { left: leftNode, right: rightNode };
  }

  /**
   * Check if a node should be processed (using the callback)
   */
  async shouldProcessNode(node: RangeNode<T>): Promise<boolean> {
    if (!this.shouldProcess) {
      return true;
    }

    const flags: ProcessFlags = {
      depth: node.depth,
      path: node.path,
      isLeaf: node.isLeaf,
    };

    try {
      return await this.shouldProcess(node.range, flags);
    } catch (error) {
      console.error(`Error in shouldProcess callback for node ${node.id}:`, error);
      return false;
    }
  }

  /**
   * Mark a node and its entire subtree as skipped
   */
  async skipSubtree(nodeId: string): Promise<void> {
    const node = await this.nodeStore.get(nodeId);
    if (!node) {
      return;
    }

    // Mark this node as skipped
    await this.nodeStore.updateStatus(node.id, NodeStatus.SKIPPED);

    // Recursively skip children
    if (node.leftChildId) {
      await this.skipSubtree(node.leftChildId);
    }
    if (node.rightChildId) {
      await this.skipSubtree(node.rightChildId);
    }
  }

  /**
   * Get a snapshot of the tree structure
   */
  async getSnapshot(rootNodeId: string): Promise<RangeNodeSnapshot<T>> {
    const node = await this.nodeStore.get(rootNodeId);
    if (!node) {
      throw new Error(`Root node ${rootNodeId} not found`);
    }

    return this.buildSnapshot(node);
  }

  /**
   * Build a recursive snapshot of a node and its children
   */
  private async buildSnapshot(node: RangeNode<T>): Promise<RangeNodeSnapshot<T>> {
    const snapshot: RangeNodeSnapshot<T> = {
      id: node.id,
      range: node.range,
      status: node.status,
      depth: node.depth,
      isLeaf: node.isLeaf,
      error: node.error,
    };

    // Recursively build children
    if (node.leftChildId) {
      const leftChild = await this.nodeStore.get(node.leftChildId);
      if (leftChild) {
        snapshot.leftChild = await this.buildSnapshot(leftChild);
      }
    }

    if (node.rightChildId) {
      const rightChild = await this.nodeStore.get(node.rightChildId);
      if (rightChild) {
        snapshot.rightChild = await this.buildSnapshot(rightChild);
      }
    }

    return snapshot;
  }

  /**
   * Check if a range is small enough to be a leaf
   */
  private isLeafSize(range: Range<T>): boolean {
    return this.adapter.size(range) <= this.maxRangeSize;
  }

  /**
   * Calculate the size of a range using adapter
   */
  rangeSize(range: Range<T>): number {
    return this.adapter.size(range);
  }

  /**
   * Check if a range is valid using adapter
   */
  isValidRange(range: Range<T>): boolean {
    return this.adapter.isValid(range);
  }

  /**
   * Static helper to calculate range size with provided adapter
   */
  static rangeSize<T>(range: Range<T>, adapter: RangeAdapter<T>): number {
    return adapter.size(range);
  }

  /**
   * Static helper to validate range with provided adapter
   */
  static isValidRange<T>(range: Range<T>, adapter: RangeAdapter<T>): boolean {
    return adapter.isValid(range);
  }
}

