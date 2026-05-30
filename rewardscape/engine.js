/* ═══════════════════════════════════════════════════════════════════════════
   RewardScape — 報酬地形の彫刻師
   ─────────────────────────────────────────────────────────────────────────
   実験的PWAゲーム: ユーザーが報酬関数を彫刻し、
   ニューラルネットワークエージェントの学習過程をリアルタイムで観察する。

   ■ ゲームデザイン仮説:
   「なぜ面白いのか」— 従来のゲームではプレイヤーはキャラクターを操作する。
   本作ではプレイヤーは「動機そのもの」を彫刻する。エージェントの知性が
   報酬地形に適応していく過程で、プレイヤーは3つの知的カタルシスを得る：
     1. 創発の驚き — 自分が設計した報酬から予想外の戦略が生まれる瞬間
     2. 報酬ハッキングの発見 — エージェントが報酬の「抜け穴」を見つけ、
        意図しない行動を取る時の知的スリル
     3. 彫刻の美学 — 報酬地形自体が3D空間で美しいアート作品になり、
        その上をエージェントの軌跡が光の線となって描かれる

   ■ 学習のメタファー:
   「報酬地形」= 教師の意図、「エージェントの軌跡」= 生徒の解釈。
   教師が完璧な報酬を設計できない限り、生徒は常に予想外の解を見つける。
   これは機械学習における「報酬設計問題(Reward Design Problem)」の
   インタラクティブな体験である。

   ■ アーキテクチャ:
   - 32×32グリッドベースの報酬マップ (Float32Array)
   - エージェント: ポリシーネットワーク (8入力→16隠れ→16隠れ→4出力)
   - 学習: REINFORCE (ポリシー勾配法) + エントロピーボーナス
     - 技術的根拠: Q学習はテーブルベースで離散状態に適するが、
       連続的な報酬地形の勾配を活用するにはポリシー勾配法が適切。
       また、ポリシーの確率分布を可視化できるため、
       学習過程の直感的理解に最適。
   - 可視化: Three.js (地形メッシュ + パーティクル + 勾配矢印)
   - 2Dオーバーレイ: ニューラルネット発火、適応度グラフ、報酬ミニマップ

   ■ 60fps維持戦略:
   - 学習ステップはrAFごとに制限 (maxStepsPerFrame)
   - Three.js InstancedMeshでエージェント描画
   - 報酬テクスチャは変更時のみ更新
   - 2Dオーバーレイは4フレームおきに更新
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  //  CONSTANTS & CONFIGURATION
  // ═══════════════════════════════════════════════════
  const GRID = 32;               // 報酬マップ解像度
  const CELL_SIZE = 1.0;         // Three.js世界でのセルサイズ
  const WORLD_SIZE = GRID * CELL_SIZE;
  const HALF_WORLD = WORLD_SIZE / 2;

  const CFG = {
    // エージェント
    agentCount: 24,
    agentSpeed: 0.15,
    agentSize: 0.25,
    trailLength: 80,

    // ニューラルネット構造
    // 8入力: [gridX, gridY, localReward4方向, 速度x, 速度y]
    // →16隠れ(ReLU)→16隠れ(ReLU)→4出力(softmax: 上下左右)
    inputSize: 8,
    hidden1: 16,
    hidden2: 16,
    outputSize: 4,  // 上,下,左,右

    // 学習パラメータ (ユーザー調整可能)
    learningRate: 0.01,
    gamma: 0.95,          // 割引率
    entropyCoeff: 0.05,   // エントロピーボーナス係数
    maxEpisodeLen: 64,    // エピソード長
    stepsPerFrame: 4,     // フレームあたりの学習ステップ数
    batchSize: 8,         // ミニバッチサイズ

    // 報酬関数の重み (ユーザー調整可能)
    rewardWeights: {
      distance: 1.0,
      explore: 0.5,
      speed: 0.3,
      stability: 0.2,
      swarm: 0.0,
      spatial: 1.0,
    },
  };

  const CFG_DEFS = [
    {
      section: '学習 (Learning)', items: [
        { key: 'learningRate', label: '学習率', min: 0.001, max: 0.1, step: 0.001 },
        { key: 'gamma', label: '割引率 γ', min: 0.5, max: 0.99, step: 0.01 },
        { key: 'entropyCoeff', label: 'エントロピー係数', min: 0, max: 0.2, step: 0.005 },
        { key: 'maxEpisodeLen', label: 'エピソード長', min: 16, max: 256, step: 8 },
      ]
    },
    {
      section: 'エージェント (Agent)', items: [
        { key: 'agentCount', label: '個体数', min: 4, max: 64, step: 2 },
        { key: 'agentSpeed', label: '移動速度', min: 0.05, max: 0.5, step: 0.01 },
        { key: 'stepsPerFrame', label: 'ステップ/フレーム', min: 1, max: 16, step: 1 },
      ]
    },
  ];

  // ─── State ──────────────────────────────────────────
  let paused = false;
  let simSpeed = 1;  // 1=通常, 4=高速, 16=超高速
  let epoch = 0;
  let totalSteps = 0;
  let bestFitness = 0;
  let avgFitness = 0;
  let currentView = '3d';
  let selectedAgent = 0;

  // 学習履歴
  const fitnessHistory = { best: [], avg: [] };
  const MAX_HISTORY = 200;

  // イベントログ
  const eventLog = [];
  const MAX_LOG = 8;

  // ═══════════════════════════════════════════════════
  //  REWARD MAP — Float32ベースの報酬地形
  //  技術的根拠: Uint8では報酬の負値を表現できず、
  //  勾配の精度も不十分。Float32は[-∞,+∞]を扱えるため、
  //  引力場・斥力場の重ね合わせに最適。
  // ═══════════════════════════════════════════════════
  const rewardMap = new Float32Array(GRID * GRID);
  let rewardTextureDirty = true;

  function clearRewardMap() {
    rewardMap.fill(0);
    rewardTextureDirty = true;
  }

  function getReward(gx, gy) {
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return -1;
    return rewardMap[gy * GRID + gx];
  }

  function setReward(gx, gy, val) {
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return;
    rewardMap[gy * GRID + gx] = val;
    rewardTextureDirty = true;
  }

  /** 報酬彫刻: ブラシ塗り */
  function paintReward(cx, cy, radius, strength, mode) {
    const r = Math.floor(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) continue;
        const falloff = 1 - dist / radius;  // 二次減衰 (falloff^2)
        const amount = strength * falloff * falloff;
        const idx = gy * GRID + gx;
        switch (mode) {
          case 'attract': rewardMap[idx] += amount; break;
          case 'repel': rewardMap[idx] -= amount; break;
          case 'bonus': rewardMap[idx] = Math.max(rewardMap[idx], amount * 2); break;
          case 'penalty': rewardMap[idx] = Math.min(rewardMap[idx], -amount * 2); break;
          case 'flow': rewardMap[idx] += amount * 0.5; break;  // 方向性は別途
          case 'erase': rewardMap[idx] *= (1 - falloff * 0.8); break;
        }
      }
    }
    rewardTextureDirty = true;
  }

  /** プリセット報酬マップ */
  function applyPreset(name) {
    clearRewardMap();
    switch (name) {
      case 'maze': {
        // 壁(負報酬)とゴール(高報酬)
        for (let i = 0; i < GRID; i++) {
          setReward(10, i, -2);
          setReward(20, i, -2);
          if (i < 8 || i > 24) { setReward(10, i, 0); }
          if (i < 16 || i > GRID - 1) { setReward(20, i, 0); }
        }
        setReward(28, 28, 5); setReward(27, 28, 4); setReward(28, 27, 4);
        setReward(29, 28, 4); setReward(28, 29, 4);
        break;
      }
      case 'swarm': {
        // 中央に引力、周囲に弱い負報酬
        const cx = GRID / 2, cy = GRID / 2;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            setReward(x, y, Math.exp(-d * d / 50) * 3 - 0.2);
          }
        }
        break;
      }
      case 'spiral': {
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const dx = x - GRID / 2, dy = y - GRID / 2;
            const angle = Math.atan2(dy, dx);
            const dist = Math.sqrt(dx * dx + dy * dy);
            const spiral = Math.sin(angle * 2 + dist * 0.5) * (1 - dist / (GRID * 0.7));
            setReward(x, y, spiral * 2);
          }
        }
        break;
      }
      case 'gradient': {
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            setReward(x, y, (x + y) / GRID * 2 - 1);
          }
        }
        break;
      }
      case 'adversarial': {
        // 動的プリセット: 2つの高報酬がランダム移動
        const ax = 8 + Math.random() * 16, ay = 8 + Math.random() * 16;
        const bx = 8 + Math.random() * 16, by = 8 + Math.random() * 16;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const da = Math.sqrt((x - ax) ** 2 + (y - ay) ** 2);
            const db = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
            setReward(x, y, Math.exp(-da / 4) * 3 + Math.exp(-db / 4) * 3 - 0.5);
          }
        }
        break;
      }
      case 'empty':
      default:
        break;
    }
    rewardTextureDirty = true;
    addLog(`📋 プリセット「${name}」を適用`);
  }

  // ═══════════════════════════════════════════════════
  //  NEURAL NETWORK — ポリシーネットワーク
  //  技術的根拠: REINFORCEアルゴリズムのために
  //  forward()でログ確率を保持し、backward()で
  //  ポリシー勾配を計算する。
  //  He初期化: 深層ReLUネットワークの勾配消失を防ぐ。
  // ═══════════════════════════════════════════════════
  class PolicyNet {
    constructor(sizes) {
      this.sizes = sizes;
      this.numLayers = sizes.length;
      this.weights = [];
      this.biases = [];
      this.activations = [];  // テレメトリ用
      this.preActivations = [];

      for (let i = 0; i < this.numLayers; i++) {
        this.activations.push(new Float32Array(sizes[i]));
        this.preActivations.push(new Float32Array(sizes[i]));
      }

      // He初期化 (Kaiming initialization)
      // ReLU活性化関数では勾配消失を防ぐため、
      // 重みの標準偏差を sqrt(2/fanIn) に設定する。
      for (let l = 1; l < this.numLayers; l++) {
        const fanIn = sizes[l - 1], fanOut = sizes[l];
        const scale = Math.sqrt(2.0 / fanIn);
        const w = new Float32Array(fanIn * fanOut);
        const b = new Float32Array(fanOut);
        for (let i = 0; i < w.length; i++) w[i] = gaussRand() * scale;
        this.weights.push(w);
        this.biases.push(b);
      }

      // 勾配蓄積用
      this.wGrad = this.weights.map(w => new Float32Array(w.length));
      this.bGrad = this.biases.map(b => new Float32Array(b.length));
    }

    /** 順伝播: softmax出力で行動確率を返す */
    forward(input) {
      let cur = input;
      for (let i = 0; i < Math.min(cur.length, this.activations[0].length); i++) {
        this.activations[0][i] = cur[i];
        this.preActivations[0][i] = cur[i];
      }

      for (let l = 0; l < this.weights.length; l++) {
        const w = this.weights[l];
        const b = this.biases[l];
        const inSz = this.sizes[l];
        const outSz = this.sizes[l + 1];
        const out = new Float32Array(outSz);

        for (let j = 0; j < outSz; j++) {
          let sum = b[j];
          for (let i = 0; i < inSz; i++) {
            sum += cur[i] * w[i * outSz + j];
          }
          this.preActivations[l + 1][j] = sum;

          if (l < this.weights.length - 1) {
            // 隠れ層: ReLU
            out[j] = Math.max(0, sum);
          } else {
            // 出力層: softmaxのための生値 (後で処理)
            out[j] = sum;
          }
          this.activations[l + 1][j] = out[j];
        }
        cur = out;
      }

      // Softmax (数値安定性のためmax引き)
      const logits = cur;
      let maxLogit = -Infinity;
      for (let i = 0; i < logits.length; i++) {
        if (logits[i] > maxLogit) maxLogit = logits[i];
      }
      const expVals = new Float32Array(logits.length);
      let sumExp = 0;
      for (let i = 0; i < logits.length; i++) {
        expVals[i] = Math.exp(logits[i] - maxLogit);
        sumExp += expVals[i];
      }
      const probs = new Float32Array(logits.length);
      for (let i = 0; i < logits.length; i++) {
        probs[i] = expVals[i] / sumExp;
      }

      // activationsを確率で上書き
      for (let i = 0; i < probs.length; i++) {
        this.activations[this.numLayers - 1][i] = probs[i];
      }

      return probs;
    }

    /** 行動選択 (確率的) */
    sampleAction(probs) {
      let r = Math.random();
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) return i;
      }
      return probs.length - 1;
    }

    /** REINFORCEによるポリシー勾配更新
     *  技術的根拠: ∇J(θ) = E[Σ_t ∇logπ(a_t|s_t) * G_t]
     *  G_t = Σ_{k=0}^{T-t} γ^k * r_{t+k} (割引累積報酬)
     *  ベースライン減算で分散を低減
     */
    update(trajectories, lr, gamma, entropyCoeff) {
      // 勾配リセット
      for (let l = 0; l < this.wGrad.length; l++) {
        this.wGrad[l].fill(0);
        this.bGrad[l].fill(0);
      }

      let totalLoss = 0;

      for (const traj of trajectories) {
        const T = traj.states.length;
        if (T === 0) continue;

        // 割引累積報酬の計算
        const returns = new Float32Array(T);
        let G = 0;
        for (let t = T - 1; t >= 0; t--) {
          G = traj.rewards[t] + gamma * G;
          returns[t] = G;
        }

        // ベースライン (平均リターン)
        let meanReturn = 0;
        for (let t = 0; t < T; t++) meanReturn += returns[t];
        meanReturn /= T;

        // 各タイムステップで勾配を蓄積
        for (let t = 0; t < T; t++) {
          const advantage = returns[t] - meanReturn;
          const state = traj.states[t];
          const action = traj.actions[t];

          // forward再実行して中間値取得
          const probs = this.forward(state);

          // ∇log π(a|s) の計算 (softmax cross-entropy勾配)
          // d(logp[a])/d(logit[j]) = δ(a,j) - p[j]
          const outputGrad = new Float32Array(this.sizes[this.numLayers - 1]);
          for (let j = 0; j < outputGrad.length; j++) {
            outputGrad[j] = -probs[j]; // -p[j]
          }
          outputGrad[action] += 1; // +δ(a,j)

          // advantage * ∇log π + entropyCoeff * ∇H
          // H = -Σ p log p
          // ∇H/∂logit_j = p_j * (expectedLogProb - log p_j)
          // (softmax微分を考慮した正しいエントロピー勾配)
          let expectedLogProb = 0;
          for (let j = 0; j < probs.length; j++) {
            expectedLogProb += probs[j] * Math.log(Math.max(probs[j], 1e-8));
          }
          for (let j = 0; j < outputGrad.length; j++) {
            const entropyGrad = probs[j] * (expectedLogProb - Math.log(Math.max(probs[j], 1e-8)));
            outputGrad[j] = advantage * outputGrad[j] + entropyCoeff * entropyGrad;
          }

          // バックプロパゲーション
          this._backward(state, outputGrad);

          totalLoss += -Math.log(Math.max(probs[action], 1e-8)) * advantage;
        }
      }

      // 勾配適用 (SGD)
      const scale = lr / Math.max(trajectories.length, 1);
      for (let l = 0; l < this.weights.length; l++) {
        const w = this.weights[l], wg = this.wGrad[l];
        const b = this.biases[l], bg = this.bGrad[l];
        for (let i = 0; i < w.length; i++) {
          w[i] += scale * wg[i];
        }
        for (let i = 0; i < b.length; i++) {
          b[i] += scale * bg[i];
        }
      }

      return totalLoss / Math.max(trajectories.length, 1);
    }

    /** バックプロパゲーション (勾配蓄積) */
    _backward(input, outputGrad) {
      // まずforwardして中間activationsを再取得
      const acts = [];
      let cur = input;
      acts.push(new Float32Array(cur));

      for (let l = 0; l < this.weights.length; l++) {
        const w = this.weights[l], b = this.biases[l];
        const inSz = this.sizes[l], outSz = this.sizes[l + 1];
        const out = new Float32Array(outSz);
        for (let j = 0; j < outSz; j++) {
          let sum = b[j];
          for (let i = 0; i < inSz; i++) sum += cur[i] * w[i * outSz + j];
          out[j] = l < this.weights.length - 1 ? Math.max(0, sum) : sum;
        }
        acts.push(new Float32Array(out));
        cur = out;
      }

      // 逆伝播
      let delta = outputGrad;

      for (let l = this.weights.length - 1; l >= 0; l--) {
        const inSz = this.sizes[l], outSz = this.sizes[l + 1];
        const inp = acts[l];

        // ReLU微分 (出力層は恒等なので常に1)
        if (l < this.weights.length - 1) {
          for (let j = 0; j < outSz; j++) {
            if (acts[l + 1][j] <= 0) delta[j] = 0;
          }
        }

        // 重み勾配: ∂L/∂w_{ij} = inp[i] * delta[j]
        const wg = this.wGrad[l], bg = this.bGrad[l];
        for (let j = 0; j < outSz; j++) {
          bg[j] += delta[j];
          for (let i = 0; i < inSz; i++) {
            wg[i * outSz + j] += inp[i] * delta[j];
          }
        }

        // 次層のdelta
        if (l > 0) {
          const w = this.weights[l];
          const newDelta = new Float32Array(inSz);
          for (let i = 0; i < inSz; i++) {
            let sum = 0;
            for (let j = 0; j < outSz; j++) {
              sum += w[i * outSz + j] * delta[j];
            }
            newDelta[i] = sum;
          }
          delta = newDelta;
        }
      }
    }

    /** ゲノムのクローン (新エージェント生成用) */
    clone() {
      const net = new PolicyNet(this.sizes.slice());
      for (let l = 0; l < this.weights.length; l++) {
        net.weights[l].set(this.weights[l]);
        net.biases[l].set(this.biases[l]);
      }
      return net;
    }

    /** 重みの統計情報 (可視化用) */
    getStats() {
      let totalParams = 0, totalAbs = 0, maxAbs = 0;
      for (let l = 0; l < this.weights.length; l++) {
        for (let i = 0; i < this.weights[l].length; i++) {
          totalParams++;
          const v = Math.abs(this.weights[l][i]);
          totalAbs += v;
          if (v > maxAbs) maxAbs = v;
        }
      }
      return { totalParams, avgAbs: totalAbs / totalParams, maxAbs };
    }
  }

  // ─── Utility ─────────────────────────────────────
  function gaussRand() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ═══════════════════════════════════════════════════
  //  AGENT — ポリシー勾配エージェント
  // ═══════════════════════════════════════════════════
  class Agent {
    constructor(id) {
      this.id = id;
      this.brain = new PolicyNet([
        CFG.inputSize, CFG.hidden1, CFG.hidden2, CFG.outputSize
      ]);

      // 状態
      this.x = Math.random() * GRID;
      this.y = Math.random() * GRID;
      this.vx = 0;
      this.vy = 0;

      // エピソード記録
      this.trajectory = { states: [], actions: [], rewards: [] };
      this.episodeStep = 0;
      this.episodeReward = 0;
      this.totalReward = 0;
      this.episodeCount = 0;

      // 探索記録
      this.visited = new Uint8Array(GRID * GRID);
      this.visitCount = 0;

      // 軌跡 (可視化用)
      this.trail = [];

      // 色 (HSL)
      this.hue = (id * 137.5) % 360;
      this.color = new THREE.Color().setHSL(this.hue / 360, 0.8, 0.6);
    }

    /** 入力ベクトル構築
     *  8次元: [正規化X, 正規化Y, 上報酬, 下報酬, 左報酬, 右報酬, vx, vy]
     *  技術的根拠: 局所的な報酬勾配を入力に含めることで、
     *  エージェントは報酬マップの「勾配」を知覚でき、
     *  勾配上昇に相当する行動を学習できる。
     */
    getState() {
      const gx = Math.floor(this.x), gy = Math.floor(this.y);
      return new Float32Array([
        this.x / GRID - 0.5,
        this.y / GRID - 0.5,
        getReward(gx, gy - 1),  // 上
        getReward(gx, gy + 1),  // 下
        getReward(gx - 1, gy),  // 左
        getReward(gx + 1, gy),  // 右
        clamp(this.vx * 2, -1, 1),
        clamp(this.vy * 2, -1, 1),
      ]);
    }

    /** 1ステップ実行 */
    step() {
      const state = this.getState();
      const probs = this.brain.forward(state);
      const action = this.brain.sampleAction(probs);

      // 行動→速度更新
      const speed = CFG.agentSpeed;
      const dirs = [
        [0, -speed],  // 上
        [0, speed],   // 下
        [-speed, 0],  // 左
        [speed, 0],   // 右
      ];
      this.vx = this.vx * 0.3 + dirs[action][0] * 0.7;
      this.vy = this.vy * 0.3 + dirs[action][1] * 0.7;

      // 位置更新
      this.x = clamp(this.x + this.vx, 0, GRID - 0.01);
      this.y = clamp(this.y + this.vy, 0, GRID - 0.01);

      // 報酬計算
      const reward = this._computeReward(state);

      // 軌跡記録
      this.trajectory.states.push(state);
      this.trajectory.actions.push(action);
      this.trajectory.rewards.push(reward);
      this.episodeReward += reward;
      this.episodeStep++;

      // 訪問記録
      const gx = Math.floor(this.x), gy = Math.floor(this.y);
      const gi = gy * GRID + gx;
      if (gi >= 0 && gi < this.visited.length && !this.visited[gi]) {
        this.visited[gi] = 1;
        this.visitCount++;
      }

      // 軌跡 (描画用)
      this.trail.push({ x: this.x, y: this.y, r: reward });
      if (this.trail.length > CFG.trailLength) this.trail.shift();

      return this.episodeStep >= CFG.maxEpisodeLen;
    }

    /** 複合報酬関数
     *  技術的根拠: 報酬は複数の成分の重み付き和。
     *  ユーザーが重みを調整することで、
     *  エージェントの行動目標を動的に変更できる。
     */
    _computeReward(state) {
      const w = CFG.rewardWeights;
      let r = 0;

      // 空間報酬マップ
      const gx = Math.floor(this.x), gy = Math.floor(this.y);
      r += w.spatial * getReward(gx, gy);

      // 移動距離報酬
      const dist = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      r += w.distance * dist;

      // 探索ボーナス (未訪問セル)
      const gi = gy * GRID + gx;
      if (gi >= 0 && gi < this.visited.length && !this.visited[gi]) {
        r += w.explore * 0.5;
      }

      // 速度報酬
      r += w.speed * dist * 0.5;

      // 安定性報酬 (急激な方向転換にペナルティ)
      // state[6,7]はclamp済み速度なので、同じ空間で比較するため現在速度もclamp
      const clampedVx = clamp(this.vx * 2, -1, 1);
      const clampedVy = clamp(this.vy * 2, -1, 1);
      r += w.stability * (1 - Math.abs(clampedVx - state[6]) - Math.abs(clampedVy - state[7])) * 0.1;

      return r;
    }

    /** エピソード終了→学習 */
    endEpisode() {
      this.totalReward += this.episodeReward;
      this.episodeCount++;
      const result = { ...this.trajectory, totalReward: this.episodeReward };

      // リセット
      this.trajectory = { states: [], actions: [], rewards: [] };
      this.episodeStep = 0;
      this.episodeReward = 0;

      // ランダム位置にリスポーン
      this.x = Math.random() * GRID;
      this.y = Math.random() * GRID;
      this.vx = 0;
      this.vy = 0;

      return result;
    }
  }

  // ═══════════════════════════════════════════════════
  //  AGENTS MANAGER
  // ═══════════════════════════════════════════════════
  let agents = [];

  function initAgents(count) {
    agents = [];
    for (let i = 0; i < count; i++) {
      agents.push(new Agent(i));
    }
    selectedAgent = 0;
  }

  function resetAgents() {
    const count = agents.length || CFG.agentCount;
    initAgents(count);
    epoch = 0;
    totalSteps = 0;
    bestFitness = 0;
    avgFitness = 0;
    fitnessHistory.best.length = 0;
    fitnessHistory.avg.length = 0;
    addLog('🔄 エージェントをリセット');
    rebuildAgentMeshes();
  }

  // ═══════════════════════════════════════════════════
  //  SIMULATION LOOP
  // ═══════════════════════════════════════════════════
  function simStep() {
    const trajectories = [];

    for (const agent of agents) {
      const done = agent.step();
      totalSteps++;

      if (done) {
        const traj = agent.endEpisode();
        trajectories.push({ agent, traj });
      }
    }

    // バッチ学習
    if (trajectories.length >= CFG.batchSize || trajectories.length > 0) {
      // 各エージェントが自分のtrajectoryで学習
      for (const { agent, traj } of trajectories) {
        agent.brain.update(
          [traj],
          CFG.learningRate,
          CFG.gamma,
          CFG.entropyCoeff
        );
      }

      // エポック更新
      if (trajectories.length > 0) {
        epoch++;
        let sumReward = 0, maxReward = -Infinity;
        for (const { traj } of trajectories) {
          sumReward += traj.totalReward;
          if (traj.totalReward > maxReward) maxReward = traj.totalReward;
        }
        const avg = sumReward / trajectories.length;
        if (maxReward > bestFitness) {
          bestFitness = maxReward;
        }
        avgFitness = avg;

        fitnessHistory.best.push(bestFitness);
        fitnessHistory.avg.push(avg);
        if (fitnessHistory.best.length > MAX_HISTORY) {
          fitnessHistory.best.shift();
          fitnessHistory.avg.shift();
        }

        // イベント検出
        if (epoch % 50 === 0) {
          addLog(`🧬 Epoch ${epoch} | Best: ${bestFitness.toFixed(2)} | Avg: ${avg.toFixed(2)}`);
        }
        if (maxReward > bestFitness * 0.95 && epoch > 10) {
          addLog('🚀 新しい最高性能に到達！');
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════
  //  THREE.JS SETUP
  // ═══════════════════════════════════════════════════
  let scene, camera, renderer, controls;
  let groundMesh, rewardDataTexture;
  let agentInstances, agentTrailLines;
  let gradientArrows;
  let clock;

  function initThreeJS() {
    const canvas = document.getElementById('mainCanvas');
    clock = new THREE.Clock();

    // レンダラー
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x0a0a1a, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // シーン
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.015);

    // カメラ
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(HALF_WORLD, 25, HALF_WORLD + 20);
    camera.lookAt(HALF_WORLD, 0, HALF_WORLD);

    // コントロール
    controls = new OrbitControls(camera, canvas);
    controls.target.set(HALF_WORLD, 0, HALF_WORLD);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();

    // ─── ライティング ───
    const ambientLight = new THREE.AmbientLight(0x303050, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 30, 10);
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x00e5ff, 1.5, 60);
    pointLight.position.set(HALF_WORLD, 10, HALF_WORLD);
    scene.add(pointLight);

    // ─── 地面 (報酬ヒートマップ) ───
    createGroundMesh();

    // ─── グリッド線 ───
    createGridLines();

    // ─── エージェント ───
    rebuildAgentMeshes();

    // ─── 勾配矢印 ───
    createGradientArrows();

    // ─── 背景パーティクル ───
    createBackgroundParticles();

    // リサイズ
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    // 2Dキャンバス
    const overlay = document.getElementById('overlayCanvas');
    overlay.width = w;
    overlay.height = h;
  }

  // ─── 地面メッシュ ─────────────────────────────
  function createGroundMesh() {
    // 報酬テクスチャ (DataTexture)
    const data = new Uint8Array(GRID * GRID * 4);
    rewardDataTexture = new THREE.DataTexture(data, GRID, GRID, THREE.RGBAFormat);
    rewardDataTexture.needsUpdate = true;
    rewardDataTexture.magFilter = THREE.LinearFilter;
    rewardDataTexture.minFilter = THREE.LinearFilter;

    // カスタムシェーダーマテリアル
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        rewardTex: { value: rewardDataTexture },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        uniform sampler2D rewardTex;
        uniform float time;
        void main() {
          vUv = uv;
          vec3 pos = position;
          // 報酬値に基づく高さマッピング
          vec4 rw = texture2D(rewardTex, uv);
          float reward = (rw.r - rw.g) * 2.0; // R=正, G=負
          pos.y = reward * 1.5;
          // 微細な波動
          pos.y += sin(pos.x * 0.5 + time * 0.5) * 0.05;
          pos.y += cos(pos.z * 0.5 + time * 0.3) * 0.05;
          vPos = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        uniform sampler2D rewardTex;
        uniform float time;

        vec3 heatmap(float t) {
          // カスタムヒートマップ: 青(負)→暗(0)→緑(低正)→黄(中正)→赤(高正)
          if (t < 0.0) {
            float s = clamp(-t, 0.0, 1.0);
            return mix(vec3(0.05, 0.05, 0.12), vec3(0.1, 0.2, 0.9), s);
          }
          if (t < 0.3) return mix(vec3(0.05, 0.05, 0.12), vec3(0.0, 0.6, 0.3), t / 0.3);
          if (t < 0.6) return mix(vec3(0.0, 0.6, 0.3), vec3(0.9, 0.9, 0.1), (t - 0.3) / 0.3);
          return mix(vec3(0.9, 0.9, 0.1), vec3(1.0, 0.2, 0.1), clamp((t - 0.6) / 0.4, 0.0, 1.0));
        }

        void main() {
          vec4 rw = texture2D(rewardTex, vUv);
          float reward = (rw.r - rw.g) * 2.0;

          vec3 col = heatmap(clamp(reward, -1.0, 1.0));

          // グリッド線
          vec2 grid = fract(vUv * 32.0);
          float line = step(0.95, grid.x) + step(0.95, grid.y);
          col = mix(col, vec3(0.15, 0.2, 0.35), line * 0.3);

          // 発光エフェクト (高報酬エリア)
          float glow = max(0.0, reward) * 0.3;
          glow += sin(time * 2.0 + vPos.x * 3.0 + vPos.z * 3.0) * 0.05 * max(0.0, reward);
          col += vec3(glow * 0.5, glow * 0.8, glow);

          // エッジハイライト
          float edge = abs(dFdx(vPos.y)) + abs(dFdy(vPos.y));
          col += vec3(0.0, 0.5, 1.0) * clamp(edge * 2.0, 0.0, 0.5);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
    });

    const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(HALF_WORLD, 0, HALF_WORLD);

    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    scene.add(groundMesh);
  }

  /** 報酬テクスチャの更新 */
  function updateRewardTexture() {
    if (!rewardTextureDirty) return;
    rewardTextureDirty = false;

    const data = rewardDataTexture.image.data;
    let maxAbs = 0;
    for (let i = 0; i < GRID * GRID; i++) {
      if (Math.abs(rewardMap[i]) > maxAbs) maxAbs = Math.abs(rewardMap[i]);
    }
    rewardMaxAbs = Math.max(maxAbs, 0.01);
    const scale = maxAbs > 0 ? 1 / maxAbs : 1;

    for (let i = 0; i < GRID * GRID; i++) {
      const v = rewardMap[i] * scale;
      const idx = i * 4;
      // R = 正報酬, G = 負報酬, B = 振幅, A = 1
      data[idx + 0] = Math.floor(clamp(v, 0, 1) * 255);      // 正
      data[idx + 1] = Math.floor(clamp(-v, 0, 1) * 255);     // 負
      data[idx + 2] = Math.floor(clamp(Math.abs(v), 0, 1) * 200); // 振幅
      data[idx + 3] = 255;
    }
    rewardDataTexture.needsUpdate = true;

    // 地面メッシュの頂点も更新
    const positions = groundMesh.geometry.attributes.position;
    for (let iy = 0; iy < GRID; iy++) {
      for (let ix = 0; ix < GRID; ix++) {
        const vi = iy * GRID + ix;
        const reward = rewardMap[vi] * scale;
        positions.setY(vi, reward * 1.5);
      }
    }
    positions.needsUpdate = true;
    groundMesh.geometry.computeVertexNormals();
  }

  // ─── グリッド線 ───────────────────────────────
  function createGridLines() {
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a2040, transparent: true, opacity: 0.3 });
    const points = [];
    for (let i = 0; i <= GRID; i++) {
      const p = i * CELL_SIZE;
      points.push(new THREE.Vector3(p, 0.01, 0), new THREE.Vector3(p, 0.01, WORLD_SIZE));
      points.push(new THREE.Vector3(0, 0.01, p), new THREE.Vector3(WORLD_SIZE, 0.01, p));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.LineSegments(gridGeo, gridMat));
  }

  // ─── エージェントメッシュ (InstancedMesh) ─────
  function rebuildAgentMeshes() {
    // 既存削除
    if (agentInstances) {
      scene.remove(agentInstances);
      agentInstances.geometry.dispose();
      agentInstances.material.dispose();
    }
    if (agentTrailLines) {
      for (const line of agentTrailLines) {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      }
    }

    const count = agents.length;
    if (count === 0) return;

    // エージェント: 八面体
    const agentGeo = new THREE.OctahedronGeometry(CFG.agentSize, 0);
    const agentMat = new THREE.MeshPhongMaterial({
      color: 0x00e5ff,
      emissive: 0x003344,
      shininess: 80,
      transparent: true,
      opacity: 0.9,
    });

    agentInstances = new THREE.InstancedMesh(agentGeo, agentMat, count);
    agentInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // インスタンスカラー
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const c = agents[i].color;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    agentInstances.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    scene.add(agentInstances);

    // 軌跡線
    agentTrailLines = [];
    for (let i = 0; i < count; i++) {
      const trailGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(CFG.trailLength * 3);
      trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      trailGeo.setDrawRange(0, 0);

      const trailMat = new THREE.LineBasicMaterial({
        color: agents[i].color,
        transparent: true,
        opacity: 0.4,
        linewidth: 1,
      });

      const line = new THREE.Line(trailGeo, trailMat);
      scene.add(line);
      agentTrailLines.push(line);
    }
  }

  /** エージェント位置の更新 */
  function updateAgentMeshes() {
    if (!agentInstances) return;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const gx = Math.floor(a.x), gy = Math.floor(a.y);
      const reward = getReward(gx, gy);
      const baseY = reward * 1.5 * (rewardMaxAbs > 0 ? 1 / rewardMaxAbs : 1);

      dummy.position.set(
        a.x * CELL_SIZE,
        baseY + 0.5 + Math.sin(totalSteps * 0.05 + i) * 0.1,
        a.y * CELL_SIZE
      );
      dummy.rotation.y = Math.atan2(a.vx, a.vy);
      dummy.scale.setScalar(i === selectedAgent ? 1.3 : 1.0);
      dummy.updateMatrix();
      agentInstances.setMatrixAt(i, dummy.matrix);

      // 軌跡更新
      if (agentTrailLines && agentTrailLines[i]) {
        const line = agentTrailLines[i];
        const posAttr = line.geometry.attributes.position;
        const trail = a.trail;
        for (let t = 0; t < trail.length; t++) {
          const tx = trail[t].x * CELL_SIZE;
          const ty = trail[t].r * 0.3 + 0.3;
          const tz = trail[t].y * CELL_SIZE;
          posAttr.setXYZ(t, tx, ty, tz);
        }
        posAttr.needsUpdate = true;
        line.geometry.setDrawRange(0, trail.length);
      }
    }
    agentInstances.instanceMatrix.needsUpdate = true;
  }

  // ─── 報酬マップの最大絶対値 (正規化用) ────────
  let rewardMaxAbs = 1;

  // ─── 勾配矢印 ─────────────────────────────────
  function createGradientArrows() {
    gradientArrows = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.3,
    });
    const arrowGeo = new THREE.ConeGeometry(0.1, 0.4, 4);
    arrowGeo.rotateX(Math.PI / 2);

    // 4セルおきに矢印配置
    for (let y = 2; y < GRID; y += 4) {
      for (let x = 2; x < GRID; x += 4) {
        const arrow = new THREE.Mesh(arrowGeo, arrowMat.clone());
        arrow.position.set(x * CELL_SIZE, 0.5, y * CELL_SIZE);
        arrow.userData = { gx: x, gy: y };
        gradientArrows.add(arrow);
      }
    }
    scene.add(gradientArrows);
  }

  function updateGradientArrows() {
    if (!gradientArrows) return;
    for (const arrow of gradientArrows.children) {
      const { gx, gy } = arrow.userData;
      const c = getReward(gx, gy);
      const dx = getReward(gx + 1, gy) - getReward(gx - 1, gy);
      const dy = getReward(gx, gy + 1) - getReward(gx, gy - 1);
      const mag = Math.sqrt(dx * dx + dy * dy);

      if (mag > 0.01) {
        arrow.visible = true;
        arrow.rotation.y = Math.atan2(dx, dy);
        arrow.scale.setScalar(clamp(mag * 0.5, 0.2, 1.5));
        arrow.material.opacity = clamp(mag * 0.3, 0.1, 0.5);
      } else {
        arrow.visible = false;
      }
    }
  }

  // ─── 背景パーティクル ─────────────────────────
  function createBackgroundParticles() {
    const count = 500;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80 + HALF_WORLD;
      positions[i * 3 + 1] = Math.random() * 30 + 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80 + HALF_WORLD;

      const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.6, 0.5);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geo, mat);
    particles.userData.type = 'bgParticles';
    scene.add(particles);
  }

  // ═══════════════════════════════════════════════════
  //  2D OVERLAY RENDERING
  //  ニューラルネット可視化、グラフ、ミニマップ
  // ═══════════════════════════════════════════════════
  let overlayCtx, graphCtx, minimapCtx, neuralCtx;

  function init2DCanvases() {
    const overlay = document.getElementById('overlayCanvas');
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    overlayCtx = overlay.getContext('2d');

    graphCtx = document.getElementById('graphCanvas').getContext('2d');
    minimapCtx = document.getElementById('rewardMinimap').getContext('2d');
    neuralCtx = document.getElementById('neuralCanvas').getContext('2d');
  }

  /** 適応度グラフ描画 */
  function drawGraph() {
    const ctx = graphCtx;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = 'rgba(10, 10, 26, 0.9)';
    ctx.fillRect(0, 0, w, h);

    const best = fitnessHistory.best;
    const avg = fitnessHistory.avg;
    if (best.length < 2) return;

    // スケーリング
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < best.length; i++) {
      minVal = Math.min(minVal, avg[i], best[i]);
      maxVal = Math.max(maxVal, avg[i], best[i]);
    }
    if (maxVal === minVal) maxVal = minVal + 1;

    const pad = 4;
    const plotW = w - pad * 2, plotH = h - pad * 2;

    // グリッド
    ctx.strokeStyle = 'rgba(100, 120, 200, 0.15)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad + (plotH * i / 4);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }

    // 平均線
    ctx.strokeStyle = 'rgba(124, 77, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < avg.length; i++) {
      const x = pad + (i / (avg.length - 1)) * plotW;
      const y = pad + plotH - ((avg[i] - minVal) / (maxVal - minVal)) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ベスト線
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < best.length; i++) {
      const x = pad + (i / (best.length - 1)) * plotW;
      const y = pad + plotH - ((best[i] - minVal) / (maxVal - minVal)) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ラベル
    ctx.fillStyle = '#6a6a8a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Best: ${bestFitness.toFixed(1)}`, pad + 2, pad + 10);
    ctx.fillStyle = '#7c4dff';
    ctx.fillText(`Avg: ${avgFitness.toFixed(1)}`, pad + 2, pad + 22);
  }

  /** 報酬ミニマップ描画 */
  function drawMinimap() {
    const ctx = minimapCtx;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cellW = w / GRID, cellH = h / GRID;

    // ヒートマップ (rewardMaxAbsはupdateRewardTexture()で計算済み)

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = rewardMap[y * GRID + x] / rewardMaxAbs;
        if (v > 0) {
          const t = Math.min(v, 1);
          ctx.fillStyle = `rgba(0, ${Math.floor(180 + 75 * t)}, ${Math.floor(100 + 155 * t)}, ${0.3 + 0.7 * t})`;
        } else if (v < 0) {
          const t = Math.min(-v, 1);
          ctx.fillStyle = `rgba(${Math.floor(200 + 55 * t)}, ${Math.floor(30 * (1 - t))}, ${Math.floor(50 * (1 - t))}, ${0.3 + 0.7 * t})`;
        } else {
          ctx.fillStyle = 'rgba(10, 10, 26, 0.8)';
        }
        ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    // エージェント位置
    for (const a of agents) {
      ctx.fillStyle = `hsl(${a.hue}, 80%, 60%)`;
      ctx.beginPath();
      ctx.arc(a.x / GRID * w, a.y / GRID * h, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** ニューラルネット可視化
   *  選択されたエージェントの脳の発火パターンを
   *  リアルタイムで描画する。
   */
  function drawNeural() {
    if (currentView !== 'brain' && document.getElementById('neural-overlay').classList.contains('hidden')) return;

    const ctx = neuralCtx;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(0, 0, w, h);

    const agent = agents[selectedAgent];
    if (!agent) return;

    const brain = agent.brain;
    const layers = brain.sizes;
    const numLayers = layers.length;
    const layerNames = ['入力', '隠れ1', '隠れ2', '出力'];
    const outputNames = ['↑', '↓', '←', '→'];
    const inputNames = ['X', 'Y', 'R↑', 'R↓', 'R←', 'R→', 'Vx', 'Vy'];

    const padX = 40, padY = 30;
    const layerSpacing = (w - padX * 2) / (numLayers - 1);

    // ノード位置計算
    const nodePositions = [];
    for (let l = 0; l < numLayers; l++) {
      const positions = [];
      const count = layers[l];
      const totalH = h - padY * 2;
      const spacing = Math.min(totalH / (count + 1), 20);
      const startY = h / 2 - (count - 1) * spacing / 2;

      for (let n = 0; n < count; n++) {
        positions.push({
          x: padX + l * layerSpacing,
          y: startY + n * spacing,
        });
      }
      nodePositions.push(positions);
    }

    // 接続線 (重み)
    for (let l = 0; l < brain.weights.length; l++) {
      const w_arr = brain.weights[l];
      const inSz = layers[l], outSz = layers[l + 1];
      let maxW = 0;
      for (let i = 0; i < w_arr.length; i++) {
        if (Math.abs(w_arr[i]) > maxW) maxW = Math.abs(w_arr[i]);
      }
      if (maxW === 0) maxW = 1;

      for (let i = 0; i < inSz; i++) {
        for (let j = 0; j < outSz; j++) {
          const wt = w_arr[i * outSz + j];
          const nwt = wt / maxW;
          const alpha = Math.abs(nwt) * 0.6;
          if (alpha < 0.05) continue;

          const from = nodePositions[l][i];
          const to = nodePositions[l + 1][j];

          ctx.strokeStyle = wt > 0
            ? `rgba(0, 200, 255, ${alpha})`
            : `rgba(255, 50, 80, ${alpha})`;
          ctx.lineWidth = Math.abs(nwt) * 2;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      }
    }

    // ノード
    for (let l = 0; l < numLayers; l++) {
      for (let n = 0; n < layers[l]; n++) {
        const pos = nodePositions[l][n];
        const act = brain.activations[l][n];
        const radius = 5 + Math.abs(act) * 3;

        // 発火グロー
        if (Math.abs(act) > 0.1) {
          ctx.fillStyle = act > 0
            ? `rgba(0, 229, 255, ${Math.min(Math.abs(act) * 0.3, 0.4)})`
            : `rgba(255, 23, 68, ${Math.min(Math.abs(act) * 0.3, 0.4)})`;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // ノード本体
        ctx.fillStyle = act > 0
          ? `hsl(190, 80%, ${40 + Math.min(act, 1) * 30}%)`
          : `hsl(350, 70%, ${40 + Math.min(-act, 1) * 20}%)`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // ラベル
    ctx.fillStyle = '#6a6a8a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let l = 0; l < numLayers; l++) {
      ctx.fillText(layerNames[l], padX + l * layerSpacing, h - 8);
    }

    // 入力ラベル
    ctx.textAlign = 'right';
    ctx.font = '8px monospace';
    for (let n = 0; n < Math.min(layers[0], inputNames.length); n++) {
      const pos = nodePositions[0][n];
      ctx.fillStyle = '#4a5a7a';
      ctx.fillText(inputNames[n], pos.x - 10, pos.y + 3);
    }

    // 出力ラベル
    ctx.textAlign = 'left';
    const lastLayer = numLayers - 1;
    for (let n = 0; n < Math.min(layers[lastLayer], outputNames.length); n++) {
      const pos = nodePositions[lastLayer][n];
      const prob = brain.activations[lastLayer][n];
      ctx.fillStyle = prob > 0.3 ? '#00e5ff' : '#4a5a7a';
      ctx.fillText(`${outputNames[n]} ${(prob * 100).toFixed(0)}%`, pos.x + 10, pos.y + 3);
    }

    // エージェント情報
    ctx.fillStyle = '#00e5ff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Agent #${agent.id} | Reward: ${agent.episodeReward.toFixed(2)} | Episodes: ${agent.episodeCount}`, 10, 14);
  }

  // ═══════════════════════════════════════════════════
  //  EVENT LOG
  // ═══════════════════════════════════════════════════
  function addLog(message) {
    eventLog.push({ message, time: Date.now() });
    if (eventLog.length > MAX_LOG) eventLog.shift();

    const container = document.getElementById('event-log');
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  // ═══════════════════════════════════════════════════
  //  UI BINDING
  // ═══════════════════════════════════════════════════
  let sculptTool = 'attract';
  let sculptStrength = 1.0;
  let sculptRadius = 3;
  let isPointerDown = false;
  let raycaster, pointerVec;

  function initUI() {
    raycaster = new THREE.Raycaster();
    pointerVec = new THREE.Vector2();

    // ─── ツールバートグル ───
    document.getElementById('toggle-sculpt').addEventListener('click', () => {
      const bar = document.getElementById('sculpt-bar');
      const btn = document.getElementById('toggle-sculpt');
      bar.classList.toggle('collapsed');
      btn.classList.toggle('active');
    });
    document.getElementById('toggle-agent').addEventListener('click', () => {
      const bar = document.getElementById('agent-bar');
      const btn = document.getElementById('toggle-agent');
      bar.classList.toggle('collapsed');
      btn.classList.toggle('active');
    });

    // ─── 彫刻ツール ───
    document.querySelectorAll('.sculpt-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sculpt-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sculptTool = btn.dataset.tool;
      });
    });

    // 強度/半径スライダー
    document.getElementById('sculpt-strength').addEventListener('input', e => {
      sculptStrength = parseFloat(e.target.value);
      document.getElementById('sculpt-strength-val').textContent = sculptStrength.toFixed(1);
    });
    document.getElementById('sculpt-radius').addEventListener('input', e => {
      sculptRadius = parseInt(e.target.value);
      document.getElementById('sculpt-radius-val').textContent = sculptRadius;
    });

    // ─── ポインタイベント (報酬彫刻) ───
    const canvas = document.getElementById('mainCanvas');
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      isPointerDown = true;
      sculptAt(e);
    });
    canvas.addEventListener('pointermove', e => {
      if (!isPointerDown) return;
      sculptAt(e);
    });
    canvas.addEventListener('pointerup', () => { isPointerDown = false; });
    canvas.addEventListener('pointerleave', () => { isPointerDown = false; });

    // ─── 速度コントロール ───
    document.getElementById('btn-pause').addEventListener('click', () => {
      paused = true;
      simSpeed = 0;
      updateSpeedButtons();
    });
    document.getElementById('btn-play').addEventListener('click', () => {
      paused = false;
      simSpeed = 1;
      updateSpeedButtons();
    });
    document.getElementById('btn-fast').addEventListener('click', () => {
      paused = false;
      simSpeed = 4;
      updateSpeedButtons();
    });
    document.getElementById('btn-ultra').addEventListener('click', () => {
      paused = false;
      simSpeed = 16;
      updateSpeedButtons();
    });

    // ─── エージェントコントロール ───
    document.getElementById('btn-reset-agents').addEventListener('click', resetAgents);
    document.getElementById('btn-add-agents').addEventListener('click', () => {
      for (let i = 0; i < 4; i++) {
        agents.push(new Agent(agents.length));
      }
      rebuildAgentMeshes();
      addLog(`➕ エージェント追加 (合計 ${agents.length})`);
    });

    // ─── ビュー切替 ───
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;

        const neuralOverlay = document.getElementById('neural-overlay');
        if (currentView === 'brain') {
          neuralOverlay.classList.remove('hidden');
        } else {
          neuralOverlay.classList.add('hidden');
        }
      });
    });

    // ─── パネル開閉 ───
    document.getElementById('btn-toggle-reward-panel').addEventListener('click', () => {
      document.getElementById('reward-panel').classList.toggle('hidden');
    });
    document.getElementById('btn-toggle-config').addEventListener('click', () => {
      document.getElementById('config-panel').classList.toggle('hidden');
    });
    document.getElementById('btn-toggle-overlay').addEventListener('click', () => {
      document.getElementById('neural-overlay').classList.toggle('hidden');
    });

    document.querySelectorAll('.panel-close').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.panel).classList.add('hidden');
      });
    });

    // ─── 報酬関数スライダー ───
    const rwKeys = ['distance', 'explore', 'speed', 'stability', 'swarm', 'spatial'];
    for (const key of rwKeys) {
      const slider = document.getElementById(`rw-${key}`);
      if (!slider) continue;
      slider.addEventListener('input', () => {
        CFG.rewardWeights[key] = parseFloat(slider.value);
        document.getElementById(`rw-${key}-val`).textContent = slider.value;
        updateRewardFormula();
      });
    }

    // ─── プリセット ───
    document.getElementById('btn-presets').addEventListener('click', () => {
      document.getElementById('preset-modal').classList.remove('hidden');
    });
    document.getElementById('close-preset-modal').addEventListener('click', () => {
      document.getElementById('preset-modal').classList.add('hidden');
    });
    document.querySelectorAll('.preset-card').forEach(card => {
      card.addEventListener('click', () => {
        applyPreset(card.dataset.preset);
        document.getElementById('preset-modal').classList.add('hidden');
        updateGradientArrows();
      });
    });

    document.getElementById('btn-clear-reward').addEventListener('click', () => {
      clearRewardMap();
      addLog('🔄 報酬マップをクリア');
      updateGradientArrows();
    });

    // ─── 設定パネル生成 ───
    buildConfigPanel();

    // 初期報酬式表示
    updateRewardFormula();
  }

  function updateSpeedButtons() {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    if (paused) document.getElementById('btn-pause').classList.add('active');
    else if (simSpeed === 1) document.getElementById('btn-play').classList.add('active');
    else if (simSpeed === 4) document.getElementById('btn-fast').classList.add('active');
    else if (simSpeed === 16) document.getElementById('btn-ultra').classList.add('active');
  }

  function updateRewardFormula() {
    const w = CFG.rewardWeights;
    const el = document.getElementById('reward-formula');
    if (el) {
      el.textContent = `R = ${w.distance.toFixed(1)}·d + ${w.explore.toFixed(1)}·e + ${w.speed.toFixed(1)}·v + ${w.stability.toFixed(1)}·s + ${w.swarm.toFixed(1)}·sw + ${w.spatial.toFixed(1)}·Σmap`;
    }
  }

  function buildConfigPanel() {
    const container = document.getElementById('config-content');
    if (!container) return;
    container.innerHTML = '';

    for (const section of CFG_DEFS) {
      const sec = document.createElement('div');
      sec.className = 'config-section';
      sec.innerHTML = `<div class="config-section-title">${section.section}</div>`;

      for (const item of section.items) {
        const div = document.createElement('div');
        div.className = 'config-item';
        const curVal = CFG[item.key];
        div.innerHTML = `
          <label>${item.label} <span id="cfg-val-${item.key}">${curVal}</span></label>
          <input type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="${curVal}" data-key="${item.key}">
        `;
        const input = div.querySelector('input');
        input.addEventListener('input', () => {
          const val = parseFloat(input.value);
          CFG[input.dataset.key] = val;
          document.getElementById(`cfg-val-${input.dataset.key}`).textContent =
            val % 1 === 0 ? val : val.toFixed(3);
        });
        sec.appendChild(div);
      }
      container.appendChild(sec);
    }
  }

  /** レイキャストで報酬を彫刻 */
  function sculptAt(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerVec, camera);
    const intersects = raycaster.intersectObject(groundMesh);

    if (intersects.length > 0) {
      const point = intersects[0].point;
      const gx = Math.floor(point.x / CELL_SIZE);
      const gy = Math.floor(point.z / CELL_SIZE);

      if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
        // 彫刻中はOrbitControlsを無効化
        controls.enabled = false;
        paintReward(gx, gy, sculptRadius, sculptStrength * 0.3, sculptTool);
        updateGradientArrows();
      }
    }
  }

  // ─── ポインタアップ時にControls復帰 ────────
  document.addEventListener('pointerup', () => {
    if (controls) controls.enabled = true;
    isPointerDown = false;
  });

  // ═══════════════════════════════════════════════════
  //  MAIN LOOP
  // ═══════════════════════════════════════════════════
  let frameCount = 0;
  let lastFpsTime = performance.now();
  let fps = 60;

  function mainLoop() {
    requestAnimationFrame(mainLoop);

    const dt = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    frameCount++;

    // FPS計測
    const now = performance.now();
    if (now - lastFpsTime > 500) {
      fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
      frameCount = 0;
      lastFpsTime = now;
    }

    // ─── シミュレーション ───
    if (!paused) {
      const steps = Math.min(simSpeed * CFG.stepsPerFrame, 64);
      for (let s = 0; s < steps; s++) {
        simStep();
      }
    }

    // ─── Three.js更新 ───
    updateRewardTexture();
    groundMesh.material.uniforms.time.value = elapsed;
    updateAgentMeshes();

    // ─── レンダリング ───
    controls.update();
    renderer.render(scene, camera);

    // ─── 2Dオーバーレイ (4フレームおき) ───
    if (frameCount % 4 === 0) {
      drawMinimap();
      drawGraph();
      if (currentView === 'brain' || !document.getElementById('neural-overlay').classList.contains('hidden')) {
        drawNeural();
      }
    }

    // ─── HUD更新 ───
    document.getElementById('stat-epoch').textContent = `Epoch: ${epoch}`;
    document.getElementById('stat-best').textContent = `Best: ${bestFitness.toFixed(2)}`;
    document.getElementById('stat-avg').textContent = `Avg: ${avgFitness.toFixed(2)}`;
    document.getElementById('stat-fps').textContent = `${fps}fps`;
  }

  // ═══════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════
  function init() {
    initThreeJS();
    init2DCanvases();
    initAgents(CFG.agentCount);
    rebuildAgentMeshes();
    initUI();

    // デフォルトプリセット (螺旋は視覚的に面白い)
    applyPreset('spiral');
    updateGradientArrows();

    addLog('🎮 RewardScape 起動');
    addLog('🎨 報酬マップを彫刻してエージェントの学習を観察しよう');

    mainLoop();
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
