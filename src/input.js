// ── Input Handler ──
// Manages touch/mouse interactions for gravity pointer, wall drawing, feeding, spawning.

class InputHandler {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = {
      touching: false,
      current: { x: 0, y: 0 },
      tool: 'gravity',         // 'gravity' | 'wall' | 'feed' | 'spawn'
      drawingWall: false,
      wallStart: null,
    };

    this._feedTimer = 0;

    // Bind events
    canvas.addEventListener('pointerdown', e => this._onDown(e), { passive: false });
    canvas.addEventListener('pointermove', e => this._onMove(e), { passive: false });
    canvas.addEventListener('pointerup', e => this._onUp(e));
    canvas.addEventListener('pointercancel', e => this._onUp(e));

    // Prevent default touch behaviors
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  _getPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  _onDown(e) {
    this.state.touching = true;
    this.state.current = this._getPos(e);

    if (this.state.tool === 'wall') {
      this.state.drawingWall = true;
      this.state.wallStart = { ...this.state.current };
    }
  }

  _onMove(e) {
    if (!this.state.touching) return;
    this.state.current = this._getPos(e);
  }

  _onUp(e) {
    if (this.state.tool === 'wall' && this.state.drawingWall && this.state.wallStart) {
      const pos = this._getPos(e);
      const dx = pos.x - this.state.wallStart.x;
      const dy = pos.y - this.state.wallStart.y;
      if (dx * dx + dy * dy > 100) { // min length
        this._onWallCreated && this._onWallCreated(
          this.state.wallStart.x, this.state.wallStart.y,
          pos.x, pos.y
        );
      }
    }

    this.state.touching = false;
    this.state.drawingWall = false;
    this.state.wallStart = null;
  }

  setTool(tool) {
    this.state.tool = tool;
    this.state.touching = false;
    this.state.drawingWall = false;
    this.state.wallStart = null;
  }

  // Called each frame by main loop to process continuous actions
  processFrame(world, dt) {
    if (!this.state.touching) return;
    const { x, y } = this.state.current;

    switch (this.state.tool) {
      case 'gravity':
        world.applyLocalGravity(x, y, 800);
        break;
      case 'feed':
        this._feedTimer += dt;
        if (this._feedTimer > 0.08) {
          this._feedTimer = 0;
          world.spawnNutrient(
            x + (Math.random()-0.5)*30,
            y + (Math.random()-0.5)*30,
            3 + Math.random()*4
          );
        }
        break;
      case 'spawn':
        // Single spawn on touch, handled in onDown via main
        break;
    }
  }

  onWallCreated(cb) {
    this._onWallCreated = cb;
  }
}
