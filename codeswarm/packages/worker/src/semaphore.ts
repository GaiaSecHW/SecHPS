export class Semaphore {
  private _available: number;
  private readonly _max: number;

  constructor(max: number) {
    if (max <= 0) throw new Error('Semaphore max must be positive');
    this._available = max;
    this._max = max;
  }

  tryAcquire(): boolean {
    if (this._available > 0) { this._available--; return true; }
    return false;
  }

  release(): void {
    if (this._available < this._max) this._available++;
  }

  get available(): number { return this._available; }
}
