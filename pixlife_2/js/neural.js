/**
 * PixLife 2 - Simple Neural Network
 * Each creature has a small neural network that controls its behavior.
 * Inputs: nearby food scent, pheromone gradients, nest direction, energy, nearby creatures
 * Outputs: movement direction (dx, dy), pheromone drop intensity
 */

export class NeuralNet {
  /**
   * @param {number} inputSize
   * @param {number} hiddenSize
   * @param {number} outputSize
   */
  constructor(inputSize = 12, hiddenSize = 8, outputSize = 4) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    // Weights: input→hidden, hidden→output
    this.wIH = NeuralNet.randomMatrix(hiddenSize, inputSize);
    this.bH = NeuralNet.randomArray(hiddenSize, 0.1);
    this.wHO = NeuralNet.randomMatrix(outputSize, hiddenSize);
    this.bO = NeuralNet.randomArray(outputSize, 0.1);
  }

  static randomMatrix(rows, cols) {
    const m = [];
    for (let r = 0; r < rows; r++) {
      m[r] = [];
      for (let c = 0; c < cols; c++) {
        m[r][c] = (Math.random() - 0.5) * 2;
      }
    }
    return m;
  }

  static randomArray(size, scale = 1) {
    return Array.from({ length: size }, () => (Math.random() - 0.5) * scale);
  }

  /** Hyperbolic tangent activation */
  static tanh(x) {
    if (x > 20) return 1;
    if (x < -20) return -1;
    const e2x = Math.exp(2 * x);
    return (e2x - 1) / (e2x + 1);
  }

  /** Sigmoid activation */
  static sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Forward pass
   * @param {number[]} inputs
   * @returns {number[]} outputs
   */
  forward(inputs) {
    // Hidden layer
    const hidden = new Array(this.hiddenSize);
    for (let h = 0; h < this.hiddenSize; h++) {
      let sum = this.bH[h];
      for (let i = 0; i < this.inputSize; i++) {
        sum += this.wIH[h][i] * inputs[i];
      }
      hidden[h] = NeuralNet.tanh(sum);
    }

    // Output layer
    const output = new Array(this.outputSize);
    for (let o = 0; o < this.outputSize; o++) {
      let sum = this.bO[o];
      for (let h = 0; h < this.hiddenSize; h++) {
        sum += this.wHO[o][h] * hidden[h];
      }
      output[o] = NeuralNet.tanh(sum);
    }

    return output;
  }

  /**
   * Clone with mutations
   * @param {number} mutationRate - probability of each weight mutating
   * @param {number} mutationStrength - how much to mutate
   * @returns {NeuralNet}
   */
  cloneWithMutation(mutationRate = 0.15, mutationStrength = 0.5) {
    const child = new NeuralNet(this.inputSize, this.hiddenSize, this.outputSize);

    // Copy and mutate input→hidden weights
    for (let r = 0; r < this.hiddenSize; r++) {
      for (let c = 0; c < this.inputSize; c++) {
        child.wIH[r][c] = this.wIH[r][c];
        if (Math.random() < mutationRate) {
          child.wIH[r][c] += (Math.random() - 0.5) * mutationStrength * 2;
        }
      }
    }

    // Copy and mutate hidden biases
    for (let h = 0; h < this.hiddenSize; h++) {
      child.bH[h] = this.bH[h];
      if (Math.random() < mutationRate) {
        child.bH[h] += (Math.random() - 0.5) * mutationStrength * 2;
      }
    }

    // Copy and mutate hidden→output weights
    for (let r = 0; r < this.outputSize; r++) {
      for (let c = 0; c < this.hiddenSize; c++) {
        child.wHO[r][c] = this.wHO[r][c];
        if (Math.random() < mutationRate) {
          child.wHO[r][c] += (Math.random() - 0.5) * mutationStrength * 2;
        }
      }
    }

    // Copy and mutate output biases
    for (let o = 0; o < this.outputSize; o++) {
      child.bO[o] = this.bO[o];
      if (Math.random() < mutationRate) {
        child.bO[o] += (Math.random() - 0.5) * mutationStrength * 2;
      }
    }

    return child;
  }

  /** Serialize to plain object */
  serialize() {
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      outputSize: this.outputSize,
      wIH: this.wIH,
      bH: this.bH,
      wHO: this.wHO,
      bO: this.bO
    };
  }

  /** Deserialize from plain object */
  static deserialize(data) {
    const net = new NeuralNet(data.inputSize, data.hiddenSize, data.outputSize);
    net.wIH = data.wIH;
    net.bH = data.bH;
    net.wHO = data.wHO;
    net.bO = data.bO;
    return net;
  }
}
