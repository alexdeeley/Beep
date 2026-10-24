// Converts between client (CSS pixel) coordinates, normalized canvas coordinates and
// grid cells. Every module receives device-independent values:
//
//   x, y        normalized 0..1 across the canvas (x right, y down)
//   gridX/Y     integer cell, fx/fy fractional cell position
//   distances   "units" where 1 unit = the SHORT side of the canvas
//   velocities  units per second
//
// so a gesture means the same thing on a phone and on a 4K monitor.

export class CoordinateMapper {
  constructor(grid) {
    this.grid = grid;
    this.left = 0; this.top = 0; this.width = 1; this.height = 1; this.short = 1;
  }
  setRect(left, top, width, height) {
    this.left = left; this.top = top;
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.short = Math.min(this.width, this.height);
  }
  get aspect() { return this.width / this.height; }
  normalize(clientX, clientY) {
    return {
      x: Math.min(1, Math.max(0, (clientX - this.left) / this.width)),
      y: Math.min(1, Math.max(0, (clientY - this.top) / this.height)),
    };
  }
  toGrid(nx, ny) {
    const g = this.grid;
    const fx = nx * g.cols, fy = ny * g.rows;
    return { fx, fy, gridX: Math.min(g.cols - 1, Math.max(0, Math.floor(fx))), gridY: Math.min(g.rows - 1, Math.max(0, Math.floor(fy))) };
  }
  // Normalized delta -> units (short side = 1).
  unitsX(dnx) { return dnx * this.width / this.short; }
  unitsY(dny) { return dny * this.height / this.short; }
  unitDist(nx0, ny0, nx1, ny1) { return Math.hypot(this.unitsX(nx1 - nx0), this.unitsY(ny1 - ny0)); }
}
