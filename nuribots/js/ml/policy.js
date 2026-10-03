// 脳（Net）でロボを動かすコントローラー。
// 観察 → 脳 → 行動の確率 → 乱数で1つ選ぶ。乱数は渡された Rng を使うので決定論。

import { OBS_N, N_ACT, toRealAction } from '../sim/env.js';
import { softmax, sampleIndex } from './mathx.js';

export class NetController {
  constructor(net, rng, temp = 1) {
    this.net = net;
    this.rng = rng;
    this.temp = temp;
    this.isNet = true;
    this.obs = new Float32Array(OBS_N);
    this.logits = new Float64Array(N_ACT);
    this.prob = new Float64Array(N_ACT);
    this.value = 0;
    this.lastAction = 0;   // 自分目線（0とまる 1上 2右 3下 4左 5弾）
  }
  act(env, i) {
    env.observe(i, this.obs);
    this.value = this.net.forward(this.obs, this.logits);
    softmax(this.logits, N_ACT, this.prob, this.temp);
    const a = sampleIndex(this.prob, N_ACT, this.rng.next());
    this.lastAction = a;
    return toRealAction(i, a);
  }
}
