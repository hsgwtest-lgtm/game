// しくみの説明
import { $ } from './dom.js';

const C = { noc: '#49c8ff', gold: '#f2c35b', jelly: '#ff5fa8', foam: '#e2f3ff', cur: '#6f86a3', line: 'rgba(140,190,230,0.3)' };

const SVG_BODY = `
<svg viewBox="0 0 340 190" role="img" aria-label="1粒の体と4本の触角">
  <defs><radialGradient id="g1"><stop offset="0" stop-color="${C.noc}" stop-opacity="0.9"/><stop offset="1" stop-color="${C.noc}" stop-opacity="0"/></radialGradient></defs>
  <circle cx="80" cy="120" r="26" fill="url(#g1)"/>
  <circle cx="80" cy="120" r="5" fill="${C.foam}"/>
  <line x1="80" y1="120" x2="150" y2="120" stroke="${C.line}" stroke-dasharray="3 3"/>
  <line x1="80" y1="120" x2="137" y2="80" stroke="${C.line}" stroke-dasharray="3 3"/>
  <line x1="80" y1="120" x2="137" y2="160" stroke="${C.line}" stroke-dasharray="3 3"/>
  <circle cx="150" cy="120" r="5" fill="none" stroke="${C.noc}"/><text x="158" y="124" fill="${C.foam}" font-size="11">前</text>
  <circle cx="137" cy="80" r="5" fill="none" stroke="${C.noc}"/><text x="145" y="78" fill="${C.foam}" font-size="11">左前</text>
  <circle cx="137" cy="160" r="5" fill="none" stroke="${C.noc}"/><text x="145" y="170" fill="${C.foam}" font-size="11">右前</text>
  <text x="56" y="160" fill="${C.foam}" font-size="11">ここ</text>
  <rect x="200" y="40" width="124" height="120" rx="12" fill="rgba(73,200,255,0.06)" stroke="${C.line}"/>
  <text x="262" y="62" fill="${C.foam}" font-size="12" text-anchor="middle">本能</text>
  <text x="262" y="78" fill="${C.cur}" font-size="10" text-anchor="middle">全員が同じ脳</text>
  <text x="214" y="104" fill="${C.foam}" font-size="11">→ 曲がる</text>
  <text x="214" y="124" fill="${C.foam}" font-size="11">→ 速さ</text>
  <text x="214" y="144" fill="${C.foam}" font-size="11">→ 光る</text>
  <path d="M168 110 C 182 100, 188 96, 198 92" stroke="${C.noc}" fill="none" stroke-width="1.2"/>
  <text x="20" y="30" fill="${C.cur}" font-size="10">餌のにおい・岩・外の光・振動・仲間の気配・仲間の光</text>
</svg>`;

function svgWorlds() {
  let s = '<svg viewBox="0 0 340 200" role="img" aria-label="16の並列世界">';
  for (let k = 0; k < 16; k++) {
    const x = 20 + (k % 4) * 46, y = 14 + Math.floor(k / 4) * 46;
    const col = k === 0 ? C.noc : k === 1 ? C.gold : C.line;
    s += `<rect x="${x}" y="${y}" width="40" height="40" rx="5" fill="rgba(73,200,255,0.05)" stroke="${col}"/>`;
    const lab = k === 0 ? 'いま' : k === 1 ? '最高' : (k % 2 === 0 ? '＋' : '−');
    s += `<text x="${x + 20}" y="${y + 25}" fill="${k < 2 ? col : C.cur}" font-size="10" text-anchor="middle">${lab}</text>`;
  }
  s += `<text x="216" y="40" fill="${C.foam}" font-size="11">いま: 平均の本能 μ</text>`;
  s += `<text x="216" y="62" fill="${C.foam}" font-size="11">＋／−: μ ± σε</text>`;
  s += `<text x="216" y="78" fill="${C.cur}" font-size="10">鏡あわせの変異体7組</text>`;
  s += `<text x="216" y="104" fill="${C.foam}" font-size="11">同じ条件で走らせて</text>`;
  s += `<text x="216" y="120" fill="${C.foam}" font-size="11">順位をつけ、上位の</text>`;
  s += `<text x="216" y="136" fill="${C.foam}" font-size="11">変異の向きへ μ を動かす</text>`;
  s += `<text x="216" y="162" fill="${C.cur}" font-size="10">効いた重みは σ を広げ、</text>`;
  s += `<text x="216" y="176" fill="${C.cur}" font-size="10">効かない重みはせばめる</text>`;
  return s + '</svg>';
}

const SVG_SCALE = `
<svg viewBox="0 0 340 150" role="img" aria-label="小さく学んで大きく動かす">
  <rect x="20" y="40" width="48" height="72" rx="5" fill="rgba(73,200,255,0.06)" stroke="${C.line}"/>
  ${Array.from({ length: 26 }, (_, i) => `<circle cx="${26 + ((i * 37) % 36)}" cy="${48 + ((i * 53) % 58)}" r="1.4" fill="${C.noc}"/>`).join('')}
  <text x="44" y="130" fill="${C.cur}" font-size="10" text-anchor="middle">学習: 1,024粒</text>
  <path d="M86 76 H 150" stroke="${C.gold}" stroke-width="1.5"/><path d="M144 70 L152 76 L144 82" fill="none" stroke="${C.gold}" stroke-width="1.5"/>
  <text x="118" y="66" fill="${C.gold}" font-size="10" text-anchor="middle">同じ本能</text>
  <rect x="170" y="14" width="96" height="124" rx="6" fill="rgba(73,200,255,0.06)" stroke="${C.line}"/>
  ${Array.from({ length: 140 }, (_, i) => `<circle cx="${174 + ((i * 41) % 88)}" cy="${18 + ((i * 67) % 116)}" r="1" fill="${C.noc}" opacity="0.8"/>`).join('')}
  <text x="300" y="70" fill="${C.foam}" font-size="11" text-anchor="middle">本番</text>
  <text x="300" y="86" fill="${C.cur}" font-size="10" text-anchor="middle">131,072粒</text>
</svg>`;

export function createHow(app) {
  const el = $('#s-how');
  el.innerHTML = `
    <div class="top"><button class="iconbtn" data-a="back" aria-label="もどる">‹</button><h2>しくみ</h2></div>
    <div class="body">
      <section class="sec">
        <h3>十万匹に、命令はできない</h3>
        <p>NOCTILUCA（夜光虫）の群れには、リーダーがいません。十万の粒が、それぞれ自分のまわりだけを感じて、自分で動きます。</p>
        <p>だから、あなたが一匹ずつ動かすことはできません。変えられるのは、<span class="k">全員がまったく同じものを持っている「本能」</span>だけ。その本能をどう作ればよいかは、人が考えてもなかなか分かりません。そこで、機械学習（進化戦略）に探してもらいます。</p>
      </section>
      <section class="sec">
        <h3>1粒の体</h3>
        ${SVG_BODY}
        <p>体には4つの感じる場所（ここ・前・左前・右前）があります。それぞれの場所で「餌のにおい」「岩」「外の光」「クラゲの振動」「仲間の気配」「仲間の光」の強さを感じ、左と右の差、前とここの差を本能に入れます。</p>
        <p>本能は小さなニューラルネット（神経 8〜16個）です。答えは「どれだけ曲がるか」「どれだけ速く泳ぐか」「どれだけ光るか」の3つだけ。光るには元気を使います。</p>
      </section>
      <section class="sec">
        <h3>左右対称の本能</h3>
        <p>本能は、鏡に映しても同じになるように作ってあります。「右から来たクラゲを左へよける」ことを覚えると、同時に「左から来たクラゲを右へよける」ことも身につきます。そのぶん、少ない世代で賢くなります。</p>
      </section>
      <section class="sec">
        <h3>16の並列世界で進化する</h3>
        ${svgWorlds()}
        <p>進化の画面の16の世界は、ぜんぶ同じ海・同じ生まれ方です。ちがうのは本能だけ。だから、成績の差はそのまま本能の差です。</p>
        <p>使っているのは <span class="k">SNES（分離型自然進化戦略）</span>という機械学習の方法です。重み1つ1つに「平均 μ」と「ゆらぎ σ」を持ち、世代ごとに少しずつ良い方へ動かします。「最高」は、これまでで一番よかった本能。いまの本能が迷子になったら、そこへ戻ります。</p>
      </section>
      <section class="sec">
        <h3>本能は受けつがれる</h3>
        <p>次の試練は、前の試練でいちばんよかった本能から始まります。新しい感覚がふえると、その感覚につながる重みは0から始まり、<span class="k">大きくゆらして</span>探します。前から持っていた重みは、せっかく身についたくせを忘れないように、小さくしかゆらしません。</p>
      </section>
      <section class="sec">
        <h3>小さく学び、大きく動かす</h3>
        ${SVG_SCALE}
        <p>学習では1つの世界に1,024粒。本番では、その本能をそのまま十万をこえる群れに入れます。本能は「自分のまわりだけを見て動くきまり」なので、数がふえてもそのまま働きます。粒の数で場の値をそろえているので、密度の感じ方も同じです。</p>
      </section>
      <section class="sec">
        <h3>光のことばは、だれも決めていない</h3>
        <p>「危険を感じたら光る」「仲間の光を見たら逃げる」── そんなきまりを、だれもプログラムしていません。光ることができて、光を感じることができて、生きのびた群れの本能が残る。それだけで、光に意味が生まれることがあります。</p>
        <p>「本能のくせ」のタブでは、本能が何に近づき・何から離れ・いつ光るかが、世代ごとに変わっていくのが見えます。「脳」のタブは、重みの地図です（青＝プラス、ピンク＝マイナス、金のふち＝前の世代から変わった重み）。</p>
      </section>
      <section class="sec">
        <h3>ぜんぶ GPU の上で</h3>
        <p>16の世界 × 1,024粒 ＝ 16,384粒の本能（ニューラルネット）を、毎ステップ、GPU のシェーダーでいっせいに計算しています。粒の状態は浮動小数点のテクスチャ、餌・光・群れの気配は格子の「場」で、粒が場に足しこみ、場がにじみ、粒が場を感じる、をくり返します。</p>
      </section>
    </div>`;
  el.addEventListener('click', (e) => { if (e.target.closest('[data-a=back]')) app.go('title'); });
  return { el, enter() { $('.body', el).scrollTop = 0; }, leave() {}, frame() { app.R.clear(); } };
}
