// ── Brain: Simple Neural Network for Creature AI ──
// Each creature has a small feedforward network that maps sensory inputs to actions.
// Weights evolve through mutation during reproduction.

class Brain {
  /**
   * @param {number} inputSize  - number of sensory inputs
   * @param {number} hiddenSize - neurons in hidden layer
   * @param {number} outputSize - number of action outputs
   * @param {Float32Array|null} weights - pre-existing weights (for cloning/inheritance)
   */
  constructor(inputSize = 12, hiddenSize = 8, outputSize = 4, weights = null) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    const totalWeights = (inputSize + 1) * hiddenSize + (hiddenSize + 1) * outputSize;
    if (weights && weights.length === totalWeights) {
      this.weights = new Float32Array(weights);
    } else {
      this.weights = new Float32Array(totalWeights);
      this._randomize();
    }

    // Experience-based learning: track reward signals
    this.reward = 0;
    this.lifetime = 0;
  }

  _randomize() {
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = (Math.random() - 0.5) * 2;
    }
  }

  /**
   * Forward pass through the network.
   * @param {number[]} inputs - sensory inputs
   * @returns {number[]} outputs (action values between 0 and 1)
   */
  think(inputs) {
    const iSize = this.inputSize;
    const hSize = this.hiddenSize;
    const oSize = this.outputSize;
    const w = this.weights;

    // Hidden layer (input -> hidden with bias)
    const hidden = new Float32Array(hSize);
    let wi = 0;
    for (let h = 0; h < hSize; h++) {
      let sum = 0;
      for (let i = 0; i < iSize; i++) {
        sum += inputs[i] * w[wi++];
      }
      sum += w[wi++]; // bias
      hidden[h] = Math.tanh(sum); // activation
    }

    // Output layer (hidden -> output with bias)
    const output = new Float32Array(oSize);
    for (let o = 0; o < oSize; o++) {
      let sum = 0;
      for (let h = 0; h < hSize; h++) {
        sum += hidden[h] * w[wi++];
      }
      sum += w[wi++]; // bias
      output[o] = 1 / (1 + Math.exp(-sum)); // sigmoid
    }

    return output;
  }

  /**
   * Reinforce the current weights slightly based on accumulated reward.
   * This provides a simple lifetime learning signal.
   */
  learn(learningRate = 0.01) {
    if (this.reward <= 0) return;
    // Slightly nudge weights in their current direction proportional to reward
    const magnitude = Math.min(this.reward * learningRate, 0.05);
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] += (Math.random() - 0.5) * magnitude;
    }
    this.reward *= 0.9; // decay reward
  }

  /**
   * Create a mutated copy of this brain.
   * @param {number} mutationRate - probability of each weight being mutated
   * @param {number} mutationStrength - maximum change magnitude
   * @returns {Brain}
   */
  mutate(mutationRate = 0.15, mutationStrength = 0.5) {
    const newWeights = new Float32Array(this.weights);
    for (let i = 0; i < newWeights.length; i++) {
      if (Math.random() < mutationRate) {
        newWeights[i] += (Math.random() - 0.5) * 2 * mutationStrength;
        // Clamp weights
        if (newWeights[i] > 4) newWeights[i] = 4;
        if (newWeights[i] < -4) newWeights[i] = -4;
      }
    }
    return new Brain(this.inputSize, this.hiddenSize, this.outputSize, newWeights);
  }

  /**
   * Crossover with another brain to produce offspring brain.
   * @param {Brain} other
   * @returns {Brain}
   */
  crossover(other) {
    const newWeights = new Float32Array(this.weights.length);
    const crossPoint = Math.floor(Math.random() * this.weights.length);
    for (let i = 0; i < this.weights.length; i++) {
      newWeights[i] = i < crossPoint ? this.weights[i] : other.weights[i];
    }
    return new Brain(this.inputSize, this.hiddenSize, this.outputSize, newWeights);
  }

  clone() {
    return new Brain(this.inputSize, this.hiddenSize, this.outputSize, this.weights);
  }
}
