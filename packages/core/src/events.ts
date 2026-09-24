import type { TicketStatus, TicketSummary } from '@planora/widget-contract';

export interface PlanoraEvents {
  ready: void;
  open: void;
  close: void;
  'ticket:created': { ticket: TicketSummary };
  /** A report could not be sent now and was saved to retry later. */
  'ticket:queued': { localId: string };
  'status:changed': { ticket: TicketSummary; previous: TicketStatus };
}

export type PlanoraEventName = keyof PlanoraEvents;
export type Listener<E extends PlanoraEventName> = (payload: PlanoraEvents[E]) => void;

export class Emitter {
  private listeners = new Map<PlanoraEventName, Set<Listener<PlanoraEventName>>>();

  on<E extends PlanoraEventName>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<PlanoraEventName>);
    return () => set.delete(listener as Listener<PlanoraEventName>);
  }

  emit<E extends PlanoraEventName>(event: E, payload: PlanoraEvents[E]): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(payload);
      } catch {
        /* a host listener must never break the widget */
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
