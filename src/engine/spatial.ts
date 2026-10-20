/**
 * Uniform-grid spatial hash over integer handles. Points go into one bucket; discs
 * go into every bucket their bounding box touches. Queries visit each handle at
 * most once (via a stamp array) and allocate nothing after warm-up.
 *
 * Handles are visited in bucket order, then insertion order — deterministic for a
 * deterministic insertion sequence. Callers that need an order independent of
 * insertion (e.g. predation) sort the candidates themselves.
 */
export class SpatialHash {
  readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];
  private readonly used: number[] = [];
  private stamps = new Uint32Array(64);
  private stamp = 0;

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const b of this.used) this.buckets[b].length = 0;
    this.used.length = 0;
  }

  private col(x: number): number {
    const c = Math.floor(x / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private row(y: number): number {
    const r = Math.floor(y / this.cellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  private push(bucket: number, handle: number): void {
    const b = this.buckets[bucket];
    if (b.length === 0) this.used.push(bucket);
    b.push(handle);
  }

  insertPoint(handle: number, x: number, y: number): void {
    this.push(this.row(y) * this.cols + this.col(x), handle);
  }

  insertDisc(handle: number, x: number, y: number, r: number): void {
    const c0 = this.col(x - r), c1 = this.col(x + r);
    const r0 = this.row(y - r), r1 = this.row(y + r);
    for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) this.push(row * this.cols + c, handle);
  }

  /** Calls `visit(handle)` once for every handle in buckets overlapping the box. */
  queryBox(minX: number, minY: number, maxX: number, maxY: number, visit: (handle: number) => void): void {
    const stamp = this.nextStamp();
    const c0 = this.col(minX), c1 = this.col(maxX);
    const r0 = this.row(minY), r1 = this.row(maxY);
    for (let row = r0; row <= r1; row++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets[row * this.cols + c];
        for (let i = 0; i < b.length; i++) {
          const h = b[i];
          if (h >= this.stamps.length) this.growStamps(h);
          if (this.stamps[h] === stamp) continue;
          this.stamps[h] = stamp;
          visit(h);
        }
      }
    }
  }

  queryRadius(x: number, y: number, r: number, visit: (handle: number) => void): void {
    this.queryBox(x - r, y - r, x + r, y + r, visit);
  }

  private nextStamp(): number {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  private growStamps(handle: number): void {
    let n = this.stamps.length;
    while (n <= handle) n *= 2;
    const next = new Uint32Array(n);
    next.set(this.stamps);
    this.stamps = next;
  }
}
