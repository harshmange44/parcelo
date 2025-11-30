/**
 * Type-safe event emitter for the scheduler
 */

import { EventData, EventListener, SchedulerEvent } from '../types';

/**
 * Event emitter with strong typing
 */
export class EventEmitter {
  private listeners: Map<SchedulerEvent, Set<EventListener>>;

  constructor() {
    this.listeners = new Map();
  }

  /**
   * Register an event listener
   */
  on<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as EventListener);
  }

  /**
   * Register a one-time event listener
   */
  once<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    const wrappedListener = async (data: EventData[E]) => {
      await listener(data);
      this.off(event, wrappedListener as EventListener<EventData[E]>);
    };
    this.on(event, wrappedListener as EventListener<EventData[E]>);
  }

  /**
   * Remove an event listener
   */
  off<E extends SchedulerEvent>(
    event: E,
    listener: EventListener<EventData[E]>
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener as EventListener);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Remove all listeners for an event (or all events if none specified)
   */
  removeAllListeners(event?: SchedulerEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit an event
   */
  async emit<E extends SchedulerEvent>(
    event: E,
    data: EventData[E]
  ): Promise<void> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.size === 0) {
      return;
    }

    // Execute all listeners (async-safe)
    const promises: Promise<void>[] = [];
    for (const listener of eventListeners) {
      try {
        const result = listener(data);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (error) {
        // Log error but don't stop other listeners
        console.error(`Error in event listener for ${event}:`, error);
      }
    }

    // Wait for all async listeners
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: SchedulerEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Get all registered event types
   */
  eventNames(): SchedulerEvent[] {
    return Array.from(this.listeners.keys());
  }
}

