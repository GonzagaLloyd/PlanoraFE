/** Fixed-size buffer: oldest entries are dropped first. */
export class Ring<T> {
  private items: T[] = [];

  constructor(private readonly max: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  snapshot(): T[] {
    return this.items.slice();
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
