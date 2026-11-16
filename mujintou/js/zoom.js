// カメラの距離に応じたラベルの出し分け（Three.js 非依存。Node でも検証できる）。
//
//   引き（全体表示）… 地区名だけ。島民名は出さない（小さな島に名前が重なって島が見えなくなるため）
//   中くらい        … 地区名＋島民名。名前は小さめの字で、寄るにつれて濃くなる
//   寄り            … 島民名だけ。近い島民ほど大きな字
//
// 距離は「画面の高さが LABEL_ZOOM.refHeight のときの距離」に換算して比べる。
// 画面が低い端末（横向きのスマホなど）では、同じ距離でも島民が小さく見えるので、早めに名前を隠す。

import { LABEL_ZOOM as Z } from './config.js';

export function effectiveDistance(dist, viewH) {
  return dist * (Z.refHeight / Math.max(1, viewH));
}

// 地区名を出すか。zoomDist = カメラから注視点までの距離
export function showDistrictLabels(zoomDist, viewH) {
  return effectiveDistance(zoomDist, viewH) > Z.districtBeyond;
}

// 島民の名前ラベルの見え方。
//   zoomDist: カメラから注視点まで（ズームの段階を決める）
//   dist:     カメラからその島民まで（近い島民ほど大きく）
// 戻り値（out に書き込む）：{ show, opacity（0〜1、0.1刻み）, size（字の大きさ px、整数） }
export function nameLabelLook(zoomDist, dist, viewH, selected = false, out = {}) {
  const zoom = effectiveDistance(zoomDist, viewH);
  const d = effectiveDistance(dist, viewH);
  const far = Math.max(zoom, d);
  const fadeFrom = Z.hideBeyond - Z.fadeBand;

  // 字の大きさ：fadeFrom で最小、fullWithin で最大（整数pxに丸めて段階的に変える）
  const t = Math.min(1, Math.max(0, (fadeFrom - d) / Math.max(1, fadeFrom - Z.fullWithin)));
  let size = Math.round(Z.minFont + (Z.maxFont - Z.minFont) * t);
  // 遠いほど薄く（hideBeyond で消える）
  let opacity = far >= Z.hideBeyond ? 0 : far <= fadeFrom ? 1 : Math.round(((Z.hideBeyond - far) / Z.fadeBand) * 10) / 10;

  if (selected) {
    // 選んだ島民は、引いても名前を見失わないようにする
    opacity = 1;
    size = Math.max(size, Z.selectedMinFont);
  }
  out.show = opacity > 0;
  out.opacity = opacity;
  out.size = size;
  return out;
}
