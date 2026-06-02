export class Semaphore {
  private _available: number;
  private _max: number;

  constructor(max: number) {
    if (max <= 0) throw new Error('Semaphore max must be positive');
    this._available = max;
    this._max = max;
  }

  /** Dynamically adjust the concurrency limit.
   *  If new max is larger, the additional slots become immediately available.
   *  If new max is smaller than current running tasks (available < 0 after resize),
   *  we clamp available to 0 — no running tasks are interrupted, but no new
   *  acquisitions will succeed until enough tasks complete to free up slots. */
  resize(max: number): void {
    if (max <= 0) throw new Error('Semaphore max must be positive');
    const running = this._max - this._available;
    this._max = max;
    // available = max - running, but clamp to 0 if running > max
    this._available = Math.max(0, max - running);
  }

  tryAcquire(): boolean {
    if (this._available > 0) { this._available--; return true; }
    return false;
  }

  release(): void {
    if (this._available < this._max) this._available++;
  }

  get available(): number { return this._available; }
  get max(): number { return this._max; }
}
