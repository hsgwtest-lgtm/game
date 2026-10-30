// シミュレーション用シェーダー（GLSL ES 3.00）
//  1ステップ = 粒子の更新 → 粒子を場に落とす（密度・食べた量・発光） → 場の更新（拡散・減衰・再生） → 捕食者の更新
//  K 個の世界（タイル）を1枚のテクスチャに並べ、K 通りの本能を同時に動かす。
import { HMAX, TX } from './brain.js';

export const NPRED = 4;

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define HMAX ${HMAX}
#define HQ ${HMAX / 4}
#define TX_HB ${TX.HB}
#define TX_TW ${TX.TW}
#define TX_OW ${TX.OW}
#define TX_OB ${TX.OB}
#define TX_DE ${TX.DE}
#define TX_DT ${TX.DT}
#define NPRED ${NPRED}
`;

// 世界の並び方
const LAYOUT = `
uniform ivec2 uBlock;   // 1つの世界の粒子ブロック (bw, bh)
uniform ivec2 uTiles;   // 世界の並び (tx, ty)
uniform vec2 uWorld;    // 世界の大きさ (1.0, 1.5)
uniform vec2 uGrid;     // 場のマス数 (64, 96)
uniform vec2 uAtlas;    // 場のテクスチャの大きさ
int worldOf(ivec2 tc) { ivec2 t = tc / uBlock; return t.y * uTiles.x + t.x; }
ivec2 tileOf(int w) { return ivec2(w % uTiles.x, w / uTiles.x); }
vec2 atlasUV(int w, vec2 p) {
  vec2 cell = clamp(p / uWorld * uGrid, vec2(0.5), uGrid - 0.5);
  return (vec2(tileOf(w)) * uGrid + cell) / uAtlas;
}
`;

const HASH = `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd3(uint a, uint b, uint c) { return float(pcg(a ^ pcg(b ^ pcg(c)))) * (1.0 / 4294967296.0); }
float th(float x) { x = clamp(x, -12.0, 12.0); float e = exp(2.0 * x); return (e - 1.0) / (e + 1.0); }
float sg(float x) { return 1.0 / (1.0 + exp(-clamp(x, -30.0, 30.0))); }
`;

// 環境（壁・外の光・流れ・捕食者の気配）
const ENV = `
uniform sampler2D uEnv;    // 環境 (壁までの距離, 外の光, -, -)
uniform sampler2D uPred;   // 捕食者 (x, y, vx, vy)  NPRED x K
uniform vec4 uPredP;       // 数, 食べる半径, 食べる確率, 気配の半径
uniform vec4 uLight;       // 外の光の強さ, しきい値, 道しるべの強さ, 道しるべの半径
uniform vec2 uBeacon;
uniform vec4 uFlow;        // 種類, 強さ, a, b
uniform float uStep;

float sdf(vec2 p) { return texture(uEnv, p / uWorld).r; }
float wallProx(vec2 p) { return clamp(1.0 - sdf(p) / 0.06, 0.0, 1.0); }
uniform vec4 uMoon;
float lightAt(vec2 p) {
  float L = uLight.x * uMoon.x * texture(uEnv, p / uWorld).g;
  vec2 d = p - uBeacon;
  L += uLight.z * exp(-dot(d, d) / (uLight.w * uLight.w));
  L = max(L - uLight.y, 0.0) / (1.0 - uLight.y);
  return clamp(L, 0.0, 1.0);
}
float dangerAt(int w, vec2 p) {
  float d = 0.0;
  for (int k = 0; k < NPRED; k++) {
    if (float(k) >= uPredP.x) break;
    vec2 q = texelFetch(uPred, ivec2(k, w), 0).xy;
    float r = 1.0 - length(p - q) / uPredP.w;
    if (r > 0.0) d += r * r;
  }
  return min(d, 1.0);
}
vec2 flowAt(vec2 p) {
  int ty = int(uFlow.x + 0.5);
  if (ty == 1) {            // 横向きの帯（深さで向きが変わる）
    float s = sin(p.y * uFlow.z + uFlow.w);
    float edge = smoothstep(0.0, 0.08, p.x) * smoothstep(0.0, 0.08, uWorld.x - p.x);
    return vec2(s * (0.6 + 0.4 * edge), 0.0) * uFlow.y;
  } else if (ty == 2) {     // 下へ引きこむ流れ（蛇行つき）
    return vec2(sin(p.y * 7.0 + uStep * 0.004) * 0.35, -1.0) * uFlow.y;
  } else if (ty == 3) {     // うず
    vec2 d = p - vec2(uFlow.z, uFlow.w);
    float r2 = dot(d, d) + 0.02;
    return vec2(-d.y, d.x) / r2 * uFlow.y * 0.04;
  }
  return vec2(0.0);
}
`;

export const VS_FULL = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- 粒子の初期化
export const FS_INIT = `${HEAD}${LAYOUT}${HASH}
uniform sampler2D uEnv;
uniform float uSeed;
uniform vec4 uSpawn;      // x, y, 半径, 方式(0=円 1=全体 2=横帯)
uniform float uEnergy0;
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
layout(location=2) out vec4 oC;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  ivec2 lc = tc % uBlock;
  uint li = uint(lc.y * uBlock.x + lc.x);   // 世界の中での番号（全世界で同じ = 同じ条件で比べる）
  uint s = uint(uSeed);
  vec2 p = uSpawn.xy;
  for (int k = 0; k < 10; k++) {
    float r1 = rnd3(li, s, uint(k * 3 + 1));
    float r2 = rnd3(li, s, uint(k * 3 + 2));
    if (uSpawn.w < 0.5) {
      float a = r1 * 6.2831853;
      float r = uSpawn.z * sqrt(r2);
      p = uSpawn.xy + r * vec2(cos(a), sin(a) * 1.0);
    } else if (uSpawn.w < 1.5) {
      p = vec2(r1, r2) * uWorld;
    } else {
      p = vec2(r1 * uWorld.x, uSpawn.y + (r2 - 0.5) * uSpawn.z);
    }
    p = clamp(p, vec2(0.01), uWorld - 0.01);
    if (texture(uEnv, p / uWorld).r > 0.012) break;
  }
  float a = rnd3(li, s, 977u) * 6.2831853;
  oA = vec4(p, a - 3.14159265, 0.0);
  oB = vec4(uEnergy0, 0.0, 0.0, 0.0);
  oC = vec4(1.0, 0.0, 0.0, 0.0);
}`;

// ---------------------------------------------------------------- 粒子の更新（本能＝ニューラルネットを全粒子で）
export const FS_UPDATE = `${HEAD}${LAYOUT}${HASH}${ENV}
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uField;   // (光, 餌, 群れ, 餌場の容量)
uniform sampler2D uW;       // 本能の重み（世界ごとに1行）
uniform float uSeed;
uniform vec4 uMaskE[5];
uniform vec4 uMaskO[2];
uniform vec4 uOutMask;      // 速さ, 発光, 記憶1, 記憶2
uniform int uHidden;
uniform vec4 uPhys;         // 最高速, 最大旋回, ゆらぎ, おしあい
uniform vec4 uSensor;       // 触角の長さ, 角度, 差の倍率, -
uniform vec4 uEnergy;       // 基礎代謝, 泳ぐ代謝, 光る代謝, 食べた量→元気
uniform vec4 uFoodP;        // 1歩で食べる量, -, -, -
uniform vec4 uRew;          // 生存, 元気, 高さ, 食べた
uniform vec4 uRew2;         // ゴール, 道しるべ, ゴールの高さ, 光る罰
uniform vec4 uHeat;         // 熱水の中心x, y, 半径, 強さ
uniform vec4 uDefense;      // 自分の光でひるませる強さ, まわりの光でクラゲがくらむ明るさ, くらむ強さ, -
// 粒の状態:  A = (x, y, 向き, 速さ)  B = (元気, 発光, 食べた量, 出口にいる)  C = (生存, ごほうび合計, Σ発光×月, Σ発光)
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
layout(location=2) out vec4 oC;

vec4 F(int w, vec2 p) { return texture(uField, atlasUV(w, p)); }
vec3 squash(vec4 f) { return vec3(f.r / (f.r + 2.0), clamp(f.g, 0.0, 1.0), f.b / (f.b + 4.0)); }
float gd(float a, float b) { return clamp((a - b) * uSensor.z, -1.0, 1.0); }

vec2 unit(int j, int row, vec4 e0, vec4 e1, vec4 e2, vec4 e3, vec4 e4, vec4 o0, vec4 o1, float b) {
  int base = j * 7;
  float a = b + dot(texelFetch(uW, ivec2(base, row), 0), e0)
              + dot(texelFetch(uW, ivec2(base + 1, row), 0), e1)
              + dot(texelFetch(uW, ivec2(base + 2, row), 0), e2)
              + dot(texelFetch(uW, ivec2(base + 3, row), 0), e3)
              + dot(texelFetch(uW, ivec2(base + 4, row), 0), e4);
  float c = dot(texelFetch(uW, ivec2(base + 5, row), 0), o0)
          + dot(texelFetch(uW, ivec2(base + 6, row), 0), o1);
  return vec2(th(a + c), th(a - c));
}

float heatAt(vec2 p) {
  if (uHeat.w <= 0.0) return 0.0;
  float r = 1.0 - length(p - uHeat.xy) / uHeat.z;
  return r > 0.0 ? r * r * uHeat.w : 0.0;
}

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(uA, tc, 0);
  vec4 B = texelFetch(uB, tc, 0);
  vec4 C = texelFetch(uC, tc, 0);
  if (C.x < 0.5) {   // 死んだ粒: B.x に「死んでからの歩数」をマイナスで数える（消えていく表示用）
    oA = A; oB = vec4(min(B.x, 0.0) - 1.0, 0.0, 0.0, 0.0); oC = C;
    return;
  }
  int w = worldOf(tc);
  ivec2 lc = tc % uBlock;
  uint li = uint(lc.y * uBlock.x + lc.x);
  uint st = uint(uStep);
  uint s0 = uint(uSeed);

  vec2 p = A.xy;
  float ang = A.z;
  float v = A.w;
  float en = B.x, g0 = B.y;
  float m1 = 0.0, m2 = 0.0;
  float vmax = uPhys.x;

  // --- 4つの触角（ここ・前・左前・右前）で場を感じる
  vec2 hd = vec2(cos(ang), sin(ang));
  vec2 nl = vec2(-hd.y, hd.x);
  float sdist = uSensor.x, sa = uSensor.y;
  vec2 pC = p + hd * sdist;
  vec2 pL = p + (hd * cos(sa) + nl * sin(sa)) * sdist;
  vec2 pR = p + (hd * cos(sa) - nl * sin(sa)) * sdist;
  vec4 fH = F(w, p);
  vec3 sH = squash(fH), sC = squash(F(w, pC)), sL = squash(F(w, pL)), sR = squash(F(w, pR));
  float dH = dangerAt(w, p), dC = dangerAt(w, pC), dL = dangerAt(w, pL), dR = dangerAt(w, pR);
  float wH = wallProx(p), wC = wallProx(pC), wL = wallProx(pL), wR = wallProx(pR);
  float lH = lightAt(p), lC = lightAt(pC), lL = lightAt(pL), lR = lightAt(pR);
  vec2 fl = flowAt(p);
  float flF = clamp(dot(fl, hd) / vmax, -2.0, 2.0);
  float flL = clamp(dot(fl, nl) / vmax, -2.0, 2.0);

  // 偶（左右対称）の入力
  vec4 e0 = vec4(sH.z, sH.x, sH.y, dH);
  vec4 e1 = vec4(wH, lH, gd(sC.z, sH.z), gd(sC.x, sH.x));
  vec4 e2 = vec4(gd(sC.y, sH.y), gd(dC, dH), gd(wC, wH), gd(lC, lH));
  vec4 e3 = vec4(flF, v / vmax, en, m1);
  vec4 e4 = vec4(m2, g0, 0.0, 0.0);
  // 奇（左 − 右）の入力
  vec4 o0 = vec4(gd(sL.z, sR.z), gd(sL.x, sR.x), gd(sL.y, sR.y), gd(dL, dR));
  vec4 o1 = vec4(gd(wL, wR), gd(lL, lR), flL, 0.0);
  e0 *= uMaskE[0]; e1 *= uMaskE[1]; e2 *= uMaskE[2]; e3 *= uMaskE[3]; e4 *= uMaskE[4];
  o0 *= uMaskO[0]; o1 *= uMaskO[1];

  // --- 本能（隠れ層は4つずつ）
  int row = w;
  float tacc = 0.0;
  vec4 oacc = vec4(0.0);
  for (int q = 0; q < HQ; q++) {
    if (q * 4 >= uHidden) break;
    vec4 hb = texelFetch(uW, ivec2(TX_HB + q, row), 0);
    vec2 u0 = unit(q * 4,     row, e0, e1, e2, e3, e4, o0, o1, hb.x);
    vec2 u1 = unit(q * 4 + 1, row, e0, e1, e2, e3, e4, o0, o1, hb.y);
    vec2 u2 = unit(q * 4 + 2, row, e0, e1, e2, e3, e4, o0, o1, hb.z);
    vec2 u3 = unit(q * 4 + 3, row, e0, e1, e2, e3, e4, o0, o1, hb.w);
    vec4 hp = vec4(u0.x, u1.x, u2.x, u3.x);
    vec4 hn = vec4(u0.y, u1.y, u2.y, u3.y);
    tacc += dot(texelFetch(uW, ivec2(TX_TW + q, row), 0), hp - hn);
    vec4 hs = hp + hn;
    oacc.x += dot(texelFetch(uW, ivec2(TX_OW + q, row), 0), hs);
    oacc.y += dot(texelFetch(uW, ivec2(TX_OW + HQ + q, row), 0), hs);
    oacc.z += dot(texelFetch(uW, ivec2(TX_OW + 2 * HQ + q, row), 0), hs);
    oacc.w += dot(texelFetch(uW, ivec2(TX_OW + 3 * HQ + q, row), 0), hs);
  }
  // 近道（入力 → 出力）
  tacc += dot(texelFetch(uW, ivec2(TX_DT, row), 0), o0) + dot(texelFetch(uW, ivec2(TX_DT + 1, row), 0), o1);
  for (int k = 0; k < 4; k++) {
    int b = TX_DE + k * 5;
    float d = dot(texelFetch(uW, ivec2(b, row), 0), e0) + dot(texelFetch(uW, ivec2(b + 1, row), 0), e1)
            + dot(texelFetch(uW, ivec2(b + 2, row), 0), e2) + dot(texelFetch(uW, ivec2(b + 3, row), 0), e3)
            + dot(texelFetch(uW, ivec2(b + 4, row), 0), e4);
    if (k == 0) oacc.x += d; else if (k == 1) oacc.y += d; else if (k == 2) oacc.z += d; else oacc.w += d;
  }
  vec4 ob = texelFetch(uW, ivec2(TX_OB, row), 0);
  float turn = th(tacc);
  float spd = sg(oacc.x + ob.x);
  float glow = uOutMask.y * clamp(oacc.y + ob.y, 0.0, 1.0);   // 光らないのはタダ。正の重みがあれば、その分だけ光る
  float dm1 = uOutMask.z * th(oacc.z + ob.z);
  float dm2 = uOutMask.w * th(oacc.w + ob.w);

  // --- 動く
  float nz = (rnd3(li, st, s0) + rnd3(li ^ 0x9e3779b9u, st, s0) - 1.0) * uPhys.z;
  ang += turn * uPhys.y + nz;
  ang = mod(ang + 3.14159265, 6.2831853) - 3.14159265;
  v += (spd * vmax - v) * 0.25;
  vec2 h2 = vec2(cos(ang), sin(ang));
  vec2 vel = h2 * v + fl;
  if (uPhys.w > 0.0) {      // こみあうと押し出される（体積）
    vec2 cs = uWorld / uGrid;
    float cx1 = F(w, p + vec2(cs.x, 0.0)).b, cx0 = F(w, p - vec2(cs.x, 0.0)).b;
    float cy1 = F(w, p + vec2(0.0, cs.y)).b, cy0 = F(w, p - vec2(0.0, cs.y)).b;
    vec2 g = vec2(cx1 - cx0, cy1 - cy0) * uPhys.w;
    float gl = length(g);
    if (gl > vmax * 0.8) g *= vmax * 0.8 / gl;
    vel -= g;
  }
  vec2 pn = p + vel;
  float sdn = sdf(pn);
  if (sdn < 0.006) {        // 壁にぶつかったら押し戻して向きを変える
    vec2 e = vec2(0.006, 0.0);
    vec2 gr = vec2(sdf(pn + e.xy) - sdf(pn - e.xy), sdf(pn + e.yx) - sdf(pn - e.yx));
    vec2 n = gr / max(length(gr), 1e-6);
    pn += n * (0.006 - sdn);
    float dn = dot(h2, n);
    if (dn < 0.0) {
      h2 = normalize(h2 - 1.5 * dn * n);
      ang = atan(h2.y, h2.x);
      v *= 0.7;
    }
  }
  pn = clamp(pn, vec2(0.003), uWorld - 0.003);

  // --- 食べる・代謝
  float food = max(fH.g, 0.0);
  float eat = min(food, uFoodP.x);
  float vr = v / vmax;
  en += eat * uEnergy.w - (uEnergy.x + uEnergy.y * vr * vr + uEnergy.z * glow) - heatAt(pn);
  en = min(en, 1.0);
  float alive = en > 0.0 ? 1.0 : 0.0;
  // --- 捕食者に食べられる
  for (int k = 0; k < NPRED; k++) {
    if (float(k) >= uPredP.x) break;
    vec2 q = texelFetch(uPred, ivec2(k, w), 0).xy;
    float dk = length(pn - q);
    if (dk < uPredP.y) {
      float pr = uPredP.z * (1.0 - 0.5 * dk / uPredP.y) * (1.0 - uDefense.x * glow);
      if (uDefense.y > 0.0) {   // まわりが明るいと、クラゲは目がくらんで食べられない
        float stun = clamp(F(w, q).r / uDefense.y, 0.0, 1.0);
        pr *= 1.0 - uDefense.z * stun;
      }
      if (rnd3(li ^ 0x51ed27u, st, uint(k) + s0 * 7u) < pr) alive = 0.0;
    }
  }

  // --- この1歩のごほうび（生きている間だけ）
  float r = uRew.x + uRew.y * en + uRew.z * (pn.y / uWorld.y) + uRew.w * eat * 50.0;
  r += uRew2.x * step(uRew2.z, pn.y);
  vec2 db = pn - uBeacon;
  r += uRew2.y * exp(-dot(db, db) / 0.012);
  r -= uRew2.w * glow;
  r += uMoon.y * glow * uMoon.z;

  oA = vec4(pn, ang, v);
  oB = vec4(max(en, 0.0), glow, alive * eat, alive * step(uRew2.z, pn.y));
  oC = vec4(alive, C.y + alive * r, C.z + alive * glow * uMoon.z, C.w + alive * glow);
}`;

// ---------------------------------------------------------------- 粒子を場へ落とす（点で加算）
export const VS_DEPOSIT = `${HEAD}${LAYOUT}
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform ivec2 uPTex;
uniform vec3 uDepW;   // 群れ, 食べた量, 発光 の重み（粒子数で割る）
out vec4 vCol;
void main() {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uPTex.x, id / uPTex.x);
  vec4 C = texelFetch(uC, tc, 0);
  if (C.x < 0.5) { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); gl_PointSize = 1.0; vCol = vec4(0.0); return; }
  vec4 A = texelFetch(uA, tc, 0);
  vec4 B = texelFetch(uB, tc, 0);   // (元気, 発光, 食べた量, -)
  int w = worldOf(tc);
  vec2 cell = clamp(A.xy / uWorld * uGrid, vec2(0.0), uGrid - 0.01);
  vec2 texel = vec2(tileOf(w)) * uGrid + cell;
  gl_Position = vec4(texel / uAtlas * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vCol = vec4(uDepW.x, B.z * uDepW.y, B.y * uDepW.z, 0.0);
}`;

export const FS_DEPOSIT = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() { o = vCol; }`;

// ---------------------------------------------------------------- 場の更新
const FOOD_CAP = `
uniform vec4 uPatch[8];   // 餌場 x, y, 半径, 量
uniform int uNPatch;
float foodCap(vec2 p) {
  float c = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uNPatch) break;
    vec4 q = uPatch[i];
    float d = length(p - q.xy);
    c = max(c, q.w * (1.0 - smoothstep(q.z * 0.55, q.z, d)));
  }
  return c;
}
`;

export const FS_FIELD = `${HEAD}${LAYOUT}
uniform sampler2D uField;   // (光, 餌, 群れ, 餌場の容量)
uniform sampler2D uDep;
uniform vec4 uGlowP;      // 減衰, 拡散, 発光の倍率, -
uniform vec4 uFoodR;      // 再生の速さ, -, -, -
out vec4 o;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  ivec2 G = ivec2(uGrid);
  ivec2 l = tc % G;
  ivec2 b = tc - l;
  ivec2 xm = b + ivec2(max(l.x - 1, 0), l.y);
  ivec2 xp = b + ivec2(min(l.x + 1, G.x - 1), l.y);
  ivec2 ym = b + ivec2(l.x, max(l.y - 1, 0));
  ivec2 yp = b + ivec2(l.x, min(l.y + 1, G.y - 1));
  vec4 F0 = texelFetch(uField, tc, 0);
  vec4 D0 = texelFetch(uDep, tc, 0);
  float gn = texelFetch(uField, xm, 0).r + texelFetch(uField, xp, 0).r + texelFetch(uField, ym, 0).r + texelFetch(uField, yp, 0).r;
  float glow = uGlowP.x * ((1.0 - uGlowP.y) * F0.r + uGlowP.y * 0.25 * gn) + D0.b * uGlowP.z;
  float cap = F0.a;
  float food = max(F0.g - D0.g, 0.0);
  if (food < cap) food += uFoodR.x * (cap - food);
  float cn = texelFetch(uDep, xm, 0).r + texelFetch(uDep, xp, 0).r + texelFetch(uDep, ym, 0).r + texelFetch(uDep, yp, 0).r;
  float crowd = (D0.r * 2.0 + cn) / 6.0;
  o = vec4(min(glow, 2000.0), food, crowd, cap);
}`;

export const FS_FIELD_INIT = `${HEAD}${LAYOUT}${FOOD_CAP}
uniform float uFill;
out vec4 o;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  ivec2 G = ivec2(uGrid);
  ivec2 l = tc % G;
  vec2 pw = (vec2(l) + 0.5) / uGrid * uWorld;
  float cap = foodCap(pw);
  o = vec4(0.0, cap * uFill, 0.0, cap);
}`;

// ---------------------------------------------------------------- 捕食者の更新
export const FS_PRED = `${HEAD}${LAYOUT}${HASH}
uniform sampler2D uPred;
uniform sampler2D uField;
uniform sampler2D uEnv;
uniform vec4 uPredP;      // 数, 食べる半径, 食べる確率, 気配の半径
uniform vec4 uPredM;      // 速さ, 小回り, 見える距離, 光をこわがる強さ
uniform float uStep;
uniform float uSeed;
out vec4 o;
vec4 F(int w, vec2 p) { return texture(uField, atlasUV(w, p)); }
float sdf(vec2 p) { return texture(uEnv, p / uWorld).r; }
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPred, tc, 0);
  int k = tc.x;
  int w = tc.y;
  if (float(k) >= uPredP.x) { o = P; return; }
  vec2 p = P.xy, v = P.zw;
  float spd = uPredM.x;
  float R = uPredM.z;
  vec2 acc = vec2(0.0);
  float tot = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988 + float(k) * 0.3;
    vec2 d = vec2(cos(a), sin(a));
    float c1 = F(w, p + d * R * 0.35).b;
    float c2 = F(w, p + d * R * 0.7).b;
    float c3 = F(w, p + d * R).b;
    float c = c1 * 2.0 + c2 * 1.3 + c3;
    acc += d * c;
    tot += c;
  }
  vec2 desire;
  uint s = uint(uSeed) ^ uint(k * 131 + w * 7);
  if (tot > 0.15) {
    desire = normalize(acc + 1e-6) * spd;
  } else {
    float wa = (rnd3(s, uint(uStep / 40.0), 3u) - 0.5) * 2.4;
    vec2 dv = length(v) > 1e-6 ? normalize(v) : vec2(1.0, 0.0);
    float ca = cos(wa * 0.05), sa = sin(wa * 0.05);
    desire = vec2(dv.x * ca - dv.y * sa, dv.x * sa + dv.y * ca) * spd * 0.7;
  }
  if (uPredM.w > 0.0) {   // まぶしい光をこわがる
    vec2 cs = uWorld / uGrid * 2.0;
    float gH = F(w, p).r;
    if (gH > uPredM.w) {
      vec2 gg = vec2(F(w, p + vec2(cs.x, 0.0)).r - F(w, p - vec2(cs.x, 0.0)).r,
                     F(w, p + vec2(0.0, cs.y)).r - F(w, p - vec2(0.0, cs.y)).r);
      float fear = clamp((gH - uPredM.w) / uPredM.w, 0.0, 1.0);
      vec2 away = -gg / max(length(gg), 1e-6);
      if (length(gg) < 1e-4) away = length(v) > 1e-6 ? -normalize(v) : vec2(0.0, 1.0);
      desire = mix(desire, away * spd * 1.1, fear);
    }
  }
  float sd = sdf(p + v * 6.0);
  if (sd < 0.05) {
    vec2 e = vec2(0.01, 0.0);
    vec2 gr = vec2(sdf(p + e.xy) - sdf(p - e.xy), sdf(p + e.yx) - sdf(p - e.yx));
    desire += gr / max(length(gr), 1e-6) * spd * (1.0 - sd / 0.05) * 1.5;
  }
  v += (desire - v) * uPredM.y;
  float vl = length(v);
  if (vl > spd) v *= spd / vl;
  p += v;
  if (p.x < 0.02 || p.x > uWorld.x - 0.02) v.x = -v.x;
  if (p.y < 0.02 || p.y > uWorld.y - 0.02) v.y = -v.y;
  p = clamp(p, vec2(0.02), uWorld - 0.02);
  o = vec4(p, v);
}`;

// ---------------------------------------------------------------- 集計（ブロックの和）
export const FS_REDUCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uS0;
uniform sampler2D uS1;
uniform ivec2 uF;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 a = vec4(0.0), b = vec4(0.0);
  for (int y = 0; y < 8; y++) {
    if (y >= uF.y) break;
    for (int x = 0; x < 8; x++) {
      if (x >= uF.x) break;
      ivec2 q = tc * uF + ivec2(x, y);
      a += texelFetch(uS0, q, 0);
      b += texelFetch(uS1, q, 0);
    }
  }
  o0 = a;
  o1 = b;
}`;

// ---------------------------------------------------------------- 餌場を置く（本番で指で）
export const FS_STAMP = `${HEAD}${LAYOUT}
uniform sampler2D uField;
uniform vec4 uStamp;   // x, y, 半径, 量
uniform int uWorldIdx;
out vec4 o;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 F = texelFetch(uField, tc, 0);
  ivec2 G = ivec2(uGrid);
  ivec2 t = tc / G;
  if (t.y * uTiles.x + t.x != uWorldIdx && uWorldIdx >= 0) { o = F; return; }
  ivec2 l = tc % G;
  vec2 pw = (vec2(l) + 0.5) / uGrid * uWorld;
  float d = length(pw - uStamp.xy);
  float c = uStamp.w * (1.0 - smoothstep(uStamp.z * 0.55, uStamp.z, d));
  F.a = max(F.a, c);
  F.g = max(F.g, c);
  o = F;
}`;
