import type { EventLog, EventLogEntry, EventType } from "./types.js";

/**
 * Default in-memory event log. Single ordered ring buffer, monotonic seq
 * numbers per log instance. A delegate_task invocation reuses the parent's
 * EventLog so the entire tree shares one ordered trace — that's essential for
 * Phase 8 smoke-test debugging and matches the "observability first" anti-goal.
 *
 * Optional `onEmit` hook lets the CLI stream events to stderr in --debug
 * mode without coupling the substrate to a specific output sink.
 */
export class InMemoryEventLog implements EventLog {
  private readonly buffer: EventLogEntry[] = [];
  private seq = 0;

  constructor(
    private readonly bind: { taskId: string; agentId: string },
    private readonly onEmit?: (entry: EventLogEntry) => void,
  ) {}

  /**
   * Bind a child task / agent so emit() stamps the right ids without the
   * caller threading them through every call. Parent log entries remain
   * untouched; the returned proxy writes into the same buffer with new
   * default ids.
   */
  withBinding(bind: { taskId: string; agentId: string }): EventLog {
    const parent = this;
    return {
      emit(type: EventType, payload: Record<string, unknown>): EventLogEntry {
        return parent.emitInternal(type, payload, bind);
      },
      entries(): readonly EventLogEntry[] {
        return parent.entries();
      },
    };
  }

  emit(type: EventType, payload: Record<string, unknown>): EventLogEntry {
    return this.emitInternal(type, payload, this.bind);
  }

  private emitInternal(
    type: EventType,
    payload: Record<string, unknown>,
    bind: { taskId: string; agentId: string },
  ): EventLogEntry {
    const entry: EventLogEntry = {
      type,
      timestamp: new Date().toISOString(),
      seq: this.seq++,
      taskId: bind.taskId,
      agentId: bind.agentId,
      payload,
    };
    this.buffer.push(entry);
    if (this.onEmit) {
      try {
        this.onEmit(entry);
      } catch {
        // never let observability sinks crash the substrate
      }
    }
    return entry;
  }

  entries(): readonly EventLogEntry[] {
    return this.buffer;
  }
}

/**
 * Convenience factory that creates a fresh InMemoryEventLog for a task root.
 */
export function createEventLog(
  bind: { taskId: string; agentId: string },
  onEmit?: (entry: EventLogEntry) => void,
): InMemoryEventLog {
  return new InMemoryEventLog(bind, onEmit);
}
