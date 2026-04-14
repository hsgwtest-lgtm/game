// ── Input Handler ──
// Manages touch/mouse interactions for various tools.

class InputHandler {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = {
      touching: false,
      current: { x: 0, y: 0 },
      tool: 'touch',  // 'touch' | 'food' | 'light' | 'rock' | 'spawn'
    };

    this._feedTimer = 0;
    this._lightTimer = 0;
    this._touchTimer = 0;
    this._selectedCreature = null;

    // Bind events
    canvas.addEventListener('pointerdown', e => this._onDown(e), { passive: false });
    canvas.addEventListener('pointermove', e => this._onMove(e), { passive: false });
    canvas.addEventListener('pointerup', e => this._onUp(e));
    canvas.addEventListener('pointercancel', e => this._onUp(e));

    // Prevent default touch behaviors for Safari
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  _getPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  _onDown(e) {
    this.state.touching = true;
    this.state.current = this._getPos(e);
  }

  _onMove(e) {
    if (!this.state.touching) return;
    this.state.current = this._getPos(e);
  }

  _onUp(e) {
    this.state.touching = false;
  }

  setTool(tool) {
    this.state.tool = tool;
    this.state.touching = false;
    this._selectedCreature = null;
  }

  // Process continuous actions each frame
  processFrame(world, dt) {
    if (!this.state.touching) return;
    const { x, y } = this.state.current;

    switch (this.state.tool) {
      case 'touch':
        this._touchTimer += dt;
        if (this._touchTimer > 0.05) {
          this._touchTimer = 0;
          world.applyTouch(x, y, 3);
        }
        break;

      case 'food':
        this._feedTimer += dt;
        if (this._feedTimer > 0.15) {
          this._feedTimer = 0;
          world.spawnFood(
            x + (Math.random() - 0.5) * 20,
            y + (Math.random() - 0.5) * 20,
            Math.random() < 0.3 ? 'fruit' : 'plant'
          );
        }
        break;

      case 'light':
        this._lightTimer += dt;
        if (this._lightTimer > 0.5) {
          this._lightTimer = 0;
          world.addLight(x, y);
        }
        break;

      case 'rock':
        // Single place on tap (handled via onDown callback)
        break;

      case 'spawn':
        // Single spawn on tap (handled via onDown callback)
        break;
    }
  }

  // Get the creature being tapped (for info panel)
  getSelectedCreature(world) {
    if (!this.state.touching) return null;
    return world.getCreatureAt(this.state.current.x, this.state.current.y);
  }
}
