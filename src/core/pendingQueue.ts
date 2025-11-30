/**
 * Priority queue for pending nodes
 */

import { PendingQueueItem } from '../types';
import { now } from '../utils/time';

/**
 * Min-heap based priority queue for O(log N) operations
 * Priority is based on: 1) depth (deeper = higher priority), 2) insertion time (FIFO)
 */
export class PendingQueue {
  private heap: PendingQueueItem[];
  private itemMap: Map<string, number>; // nodeId -> heap index

  constructor() {
    this.heap = [];
    this.itemMap = new Map();
  }

  /**
   * Add a node to the queue
   */
  enqueue(nodeId: string, jobId: string, depth: number): void {
    // Check if already in queue
    if (this.itemMap.has(nodeId)) {
      return;
    }

    const item: PendingQueueItem = {
      nodeId,
      jobId,
      depth,
      priority: this.calculatePriority(depth),
      addedAt: now(),
    };

    // Add to end and bubble up
    const index = this.heap.length;
    this.heap.push(item);
    this.itemMap.set(nodeId, index);
    this.bubbleUp(index);
  }

  /**
   * Remove and return the highest priority node
   */
  dequeue(): PendingQueueItem | null {
    if (this.heap.length === 0) {
      return null;
    }

    const item = this.heap[0];
    this.itemMap.delete(item.nodeId);

    // Move last item to root
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.itemMap.set(last.nodeId, 0);
      this.bubbleDown(0);
    }

    return item;
  }

  /**
   * Peek at the highest priority node without removing it
   */
  peek(): PendingQueueItem | null {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  /**
   * Remove a specific node from the queue
   */
  remove(nodeId: string): boolean {
    const index = this.itemMap.get(nodeId);
    if (index === undefined) {
      return false;
    }

    this.itemMap.delete(nodeId);

    // If it's the last item, just remove it
    if (index === this.heap.length - 1) {
      this.heap.pop();
      return true;
    }

    // Replace with last item
    const last = this.heap.pop()!;
    this.heap[index] = last;
    this.itemMap.set(last.nodeId, index);

    // Restore heap property
    const parent = this.parent(index);
    if (index > 0 && this.compare(index, parent) < 0) {
      this.bubbleUp(index);
    } else {
      this.bubbleDown(index);
    }

    return true;
  }

  /**
   * Check if the queue contains a node
   */
  has(nodeId: string): boolean {
    return this.itemMap.has(nodeId);
  }

  /**
   * Get the number of items in the queue
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Get all items for a specific job
   */
  getByJob(jobId: string): PendingQueueItem[] {
    return this.heap.filter(item => item.jobId === jobId);
  }

  /**
   * Remove all items for a specific job
   */
  removeByJob(jobId: string): number {
    const nodesToRemove = this.heap
      .filter(item => item.jobId === jobId)
      .map(item => item.nodeId);

    let removed = 0;
    for (const nodeId of nodesToRemove) {
      if (this.remove(nodeId)) {
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clear the entire queue
   */
  clear(): void {
    this.heap = [];
    this.itemMap.clear();
  }

  /**
   * Get all items (for debugging/inspection)
   */
  toArray(): PendingQueueItem[] {
    return [...this.heap];
  }

  // Private heap operations

  private parent(index: number): number {
    return Math.floor((index - 1) / 2);
  }

  private leftChild(index: number): number {
    return 2 * index + 1;
  }

  private rightChild(index: number): number {
    return 2 * index + 2;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = this.parent(index);
      if (this.compare(index, parentIndex) >= 0) {
        break;
      }
      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = this.leftChild(index);
      const right = this.rightChild(index);
      let smallest = index;

      if (left < this.heap.length && this.compare(left, smallest) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && this.compare(right, smallest) < 0) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;

    // Update map
    this.itemMap.set(this.heap[i].nodeId, i);
    this.itemMap.set(this.heap[j].nodeId, j);
  }

  /**
   * Compare two items (returns negative if i has higher priority)
   */
  private compare(i: number, j: number): number {
    const itemI = this.heap[i];
    const itemJ = this.heap[j];

    // Higher depth = higher priority (lower value in min-heap)
    if (itemI.depth !== itemJ.depth) {
      return itemJ.depth - itemI.depth; // Inverted for max-heap behavior on depth
    }

    // Same depth: FIFO (earlier addedAt = higher priority)
    return itemI.addedAt - itemJ.addedAt;
  }

  /**
   * Calculate priority score for an item
   * Higher depth nodes get higher priority
   */
  private calculatePriority(depth: number): number {
    return -depth; // Negative so deeper nodes have lower (higher priority) values
  }
}

