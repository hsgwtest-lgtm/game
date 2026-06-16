import { useState, useEffect, useRef } from "react";

// ── CONSTANTS ───────────────────────────────────────────────────────────────
const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const REDS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const N     = 37;
const SLICE = (2 * Math.PI) / N;
const BUF   = 300;
const DUR   = 5400;
const CHIPS = [100, 500, 1000, 5000];

const getClr = n => n === 0 ? 'g' : REDS.has(n) ? 'r' : 'b';
const clrLabel = c => c==='r'?'赤':c==='b'?'黒':'緑';
const clrHex   = c => c==='r'?'#BB2000':c==='b'?'#111':c==='g'?'#007A3D':'#444';

const OUTSIDE = [
  {k:'low',  l:'1〜18',  p:1, bg:'#0c2610', chk:n=>n>=1&&n<=18},
  {k:'even', l:'偶数',   p:1, bg:'#0c2610', chk:n=>n>0&&n%2===0},
  {k:'red',  l:'赤',     p:1, bg:'#560000', chk:n=>getClr(n)==='r'},
  {k:'blk',  l:'黒',     p:1, bg:'#080808', chk:n=>getClr(n)==='b'},
  {k:'odd',  l:'奇数',   p:1, bg:'#0c2610', chk:n=>n>0&&n%2===1},
  {k:'high', l:'19〜36', p:1, bg:'#0c2610', chk:n=>n>=19&&n<=36},
];
const DOZENS = [
  {k:'d1',l:'1st 12',p:2,bg:'#0e240e',chk:n=>n>=1&&n<=12},
  {k:'d2',l:'2nd 12',p:2,bg:'#0e240e',chk:n=>n>=13&&n<=24},
  {k:'d3',l:'3rd 12',p:2,bg:'#0e240e',chk:n=>n>=25&&n<=36},
];
const COLS_DEF = [
  {k:'c3',l:'2:1',p:2,bg:'#0a1b0a',chk:n=>n>0&&n%3===0},
  {k:'c2',l:'2:1',p:2,bg:'#0a1b0a',chk:n=>n>0&&n%3===2},
  {k:'c1',l:'2:1',p:2,bg:'#0a1b0a',chk:n=>n>0&&n%3===1},
];
const ALL_DEFS = [...OUTSIDE,...DOZENS,...COLS_DEF];

const calcWin = (bets, n) => {
  let total = 0;
  Object.entries(bets).forEach(([k,amt]) => {
    if (!amt) return;
    if (k[0]==='N') {
      if (parseInt(k.slice(1))===n) total += amt*36;
    } else {
      const d = ALL_DEFS.find(x=>x.k===k);
      if (d && d.chk(n)) total += amt*(d.p+1);
    }
  });
  return total;
};
const sumB = bets => Object.values(bets).reduce((a,v)=>a+v,0);

// ── CANVAS DRAWING ───────────────────────────────────────────────────────────
const draw = (canvas, wa, ba, br, wi) => {
  const ctx = canvas.getContext('2d');
  const cx=BUF/2, cy=BUF/2, R=cx-5;
  ctx.clearRect(0,0,BUF,BUF);

  // Wood rim
  const g1=ctx.createRadialGradient(cx*0.62,cy*0.62,0,cx,cy,R);
  g1.addColorStop(0,'#D4A843'); g1.addColorStop(0.72,'#8B6914'); g1.addColorStop(1,'#3A1E00');
  ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fillStyle=g1; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,R-2,0,Math.PI*2); ctx.strokeStyle='#EDD060'; ctx.lineWidth=2.5; ctx.stroke();

  const pO=R*0.87, pI=R*0.54;

  // Pockets
  WHEEL.forEach((num,i)=>{
    const a1=wa+i*SLICE-SLICE/2, a2=a1+SLICE, ma=wa+i*SLICE;
    ctx.beginPath(); ctx.arc(cx,cy,pO,a1,a2); ctx.arc(cx,cy,pI,a2,a1,true); ctx.closePath();
    const isW=i===wi;
    if(num===0)            ctx.fillStyle=isW?'#00EE55':'#007A3D';
    else if(REDS.has(num)) ctx.fillStyle=isW?'#FF5544':'#BB2000';
    else                   ctx.fillStyle=isW?'#4A4A4A':'#0D0D0D';
    ctx.fill();
    ctx.strokeStyle='rgba(210,168,60,0.45)'; ctx.lineWidth=0.4; ctx.stroke();

    const tR=(pO+pI)/2, tx=cx+tR*Math.cos(ma), ty=cy+tR*Math.sin(ma);
    ctx.save(); ctx.translate(tx,ty); ctx.rotate(ma+Math.PI/2);
    ctx.fillStyle='#FFF'; ctx.font=`bold ${R*0.068}px Arial`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(num.toString(),0,0); ctx.restore();
  });

  // Divider ring
  ctx.beginPath(); ctx.arc(cx,cy,pI+1,0,Math.PI*2); ctx.strokeStyle='#D4A843'; ctx.lineWidth=2; ctx.stroke();

  // Chrome bowl
  const g2=ctx.createRadialGradient(cx,cy,pI*0.15,cx,cy,pI);
  g2.addColorStop(0,'#C8C8C8'); g2.addColorStop(0.5,'#747474'); g2.addColorStop(1,'#505050');
  ctx.beginPath(); ctx.arc(cx,cy,pI,0,Math.PI*2); ctx.fillStyle=g2; ctx.fill();

  // Hub
  const hR=pI*0.50;
  const g3=ctx.createRadialGradient(cx-hR*0.3,cy-hR*0.3,0,cx,cy,hR);
  g3.addColorStop(0,'#FFE87C'); g3.addColorStop(0.45,'#C9A84C'); g3.addColorStop(1,'#6A4E00');
  ctx.beginPath(); ctx.arc(cx,cy,hR,0,Math.PI*2); ctx.fillStyle=g3; ctx.fill();
  ctx.strokeStyle='#8B6914'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,hR*0.22,0,Math.PI*2); ctx.fillStyle='rgba(255,248,200,0.85)'; ctx.fill();

  // Ball
  if(br>0){
    const bx=cx+br*Math.cos(ba), by=cy+br*Math.sin(ba);
    ctx.beginPath(); ctx.arc(bx+2,by+2,6,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.fill();
    const g4=ctx.createRadialGradient(bx-2,by-2,1,bx,by,6);
    g4.addColorStop(0,'#FFF'); g4.addColorStop(0.55,'#DDD'); g4.addColorStop(1,'#999');
    ctx.beginPath(); ctx.arc(bx,by,6,0,Math.PI*2); ctx.fillStyle=g4; ctx.fill();
    ctx.beginPath(); ctx.arc(bx-1.5,by-1.5,2.2,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.fill();
  }

  // Marker arrow
  ctx.save(); ctx.translate(cx, cy-pO-1);
  ctx.beginPath(); ctx.moveTo(0,11); ctx.lineTo(-7,-3); ctx.lineTo(7,-3); ctx.closePath();
  ctx.fillStyle='#FFD700'; ctx.fill(); ctx.strokeStyle='#7A5200'; ctx.lineWidth=1; ctx.stroke();
  ctx.restore();
};

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function Roulette() {
  const [bal, setBal]           = useState(10000);
  const [chip, setChip]         = useState(500);
  const [bets, setBets]         = useState({});
  const [lastBets, setLastBets] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult]     = useState(null);
  const [hist, setHist]         = useState([]);
  const [showRules, setShowRules] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [toast, setToast]       = useState(null);

  const cvs = useRef(null);
  const A   = useRef({wa:0,ba:0,br:0,wi:-1,p1ba:null,fwa:0,fba:0,ouR:0,inR:0,fid:null});

  // Initial draw
  useEffect(()=>{ if(cvs.current) draw(cvs.current,0,0,0,-1); },[]);

  // Toast timer
  useEffect(()=>{
    if(!toast) return;
    const id=setTimeout(()=>setToast(null),3000);
    return ()=>clearTimeout(id);
  },[toast]);

  // Cleanup animation on unmount
  useEffect(()=>()=>{ if(A.current.fid) cancelAnimationFrame(A.current.fid); },[]);

  const placeBet = k => {
    if(spinning) return;
    if(sumB(bets)+chip > bal){ setToast({m:'残高不足です',t:'e'}); return; }
    setBets(p=>({...p,[k]:(p[k]||0)+chip}));
  };

  const clearBets = () => { if(!spinning) setBets({}); };

  const doubleBets = () => {
    if(spinning) return;
    const s=sumB(bets); if(!s) return;
    if(s*2>bal){ setToast({m:'残高不足です',t:'e'}); return; }
    setBets(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v*2])));
  };

  const rebet = () => {
    if (spinning || !lastBets) return;
    const total = sumB(lastBets);
    if (!total) return;
    if (total > bal) { setToast({m:'残高不足です',t:'e'}); return; }
    setBets({...lastBets});
  };
    if(spinning) return;
    const total=sumB(bets);
    if(!total){ setToast({m:'ベットを置いてください',t:'e'}); return; }

    const newBal=bal-total; setBal(newBal);
    const wi=Math.floor(Math.random()*N), wn=WHEEL[wi], cb={...bets};
    setSpinning(true); setResult(null); setBets({});

    const a=A.current;
    const R=BUF/2-5, pO=R*0.87, pI=R*0.54;
    a.ouR=R*0.91; a.inR=(pO+pI)/2;

    // Compute final wheel angle so winning pocket lands under top marker (-π/2)
    const cur=a.wa;
    const tgtMod=(((-Math.PI/2-wi*SLICE)%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    const curMod=((cur%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    let delta=tgtMod-curMod; if(delta<=0) delta+=2*Math.PI;
    const fwa=cur+delta+7*2*Math.PI;
    a.fwa=fwa; a.fba=fwa+wi*SLICE;
    a.br=a.ouR; a.ba=-Math.PI/2; a.p1ba=null;

    const t0=performance.now(), c=cvs.current;

    const loop=now=>{
      const t=Math.min((now-t0)/DUR,1);
      const wE=1-Math.pow(1-t,3);
      a.wa=cur+(fwa-cur)*wE;

      if(t<0.72){
        const bE=1-Math.pow(1-t/0.72,2.5);
        a.ba=-Math.PI/2-10*Math.PI*2*bE;
        a.br=a.ouR; a.p1ba=a.ba;
      } else {
        const dt=(t-0.72)/0.28, dE=1-Math.pow(1-dt,2);
        const p1V=(((a.p1ba??-Math.PI/2)%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
        const fnV=((a.fba%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
        let arc=fnV-p1V; if(arc<0) arc+=2*Math.PI;
        a.ba=p1V+arc*dE;
        a.br=a.ouR+(a.inR-a.ouR)*dE;
      }

      if(c) draw(c, a.wa, a.ba, a.br, t>=1?a.wi:-1);

      if(t<1){
        a.fid=requestAnimationFrame(loop);
      } else {
        const winAmt=calcWin(cb,wn);
        setBal(newBal+winAmt);
        setResult({n:wn,c:getClr(wn),w:winAmt});
        setSpinning(false);
        setLastBets(cb);
        const net=winAmt-total;
        const lbl=clrLabel(getClr(wn));
        if(winAmt>0) setToast({m:`🎉 ${wn}（${lbl}）— +¥${net.toLocaleString()} WIN!`,t:'w'});
        else         setToast({m:`${wn}（${lbl}）— ¥${total.toLocaleString()} 負け`,t:'l'});
        setHist(p=>[{n:wn,c:getClr(wn),net},...p.slice(0,19)]);
      }
    };
    a.wi=wi; a.fid=requestAnimationFrame(loop);
  };

  const tb=sumB(bets);

  // ── Sub-components (inside render for closure access) ────────────────────
  const Badge = ({k}) => {
    const v=bets[k]||0;
    return v>0?(
      <span style={{position:'absolute',top:1,right:1,background:'#FFD700',color:'#000',
        borderRadius:'50%',width:13,height:13,fontSize:7,display:'flex',alignItems:'center',
        justifyContent:'center',fontWeight:'bold',zIndex:1,lineHeight:1,flexShrink:0}}>
        {v>=1000?`${v/1000}K`:v}
      </span>
    ):null;
  };

  const cellBase = (bg) => ({
    background:bg, color:'#FFF',
    display:'flex', alignItems:'center', justifyContent:'center',
    cursor:spinning?'not-allowed':'pointer',
    border:'1px solid rgba(201,168,76,0.25)',
    fontSize:10, fontWeight:'bold', userSelect:'none',
    position:'relative', boxSizing:'border-box',
  });

  const NC = ({n,fullH}) => {
    const k=`N${n}`;
    const bg=n===0?'#007A3D':REDS.has(n)?'#BB2000':'#0D0D0D';
    return(
      <div onClick={()=>placeBet(k)}
        style={{...cellBase(bg), ...(fullH?{gridColumn:1,gridRow:'1 / 4'}:{})}}>
        {n}<Badge k={k}/>
      </div>
    );
  };

  const BC = ({k,l,p,bg,cs}) => (
    <div onClick={()=>placeBet(k)}
      style={{...cellBase(bg), flexDirection:'column', gap:0,
        ...(cs?{gridColumn:`span ${cs}`}:{})}}>
      <span style={{fontSize:9,lineHeight:1.4,textAlign:'center'}}>{l}</span>
      <span style={{fontSize:7,color:'#C9A84C'}}>{p}:1</span>
      <Badge k={k}/>
    </div>
  );

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:'100vh',background:'#030b04',color:'#F0EBE3',
      fontFamily:'Georgia,serif',display:'flex',flexDirection:'column',alignItems:'center',paddingBottom:44}}>

      <style>{`
        @keyframes spinGlow {
          0%,100%{box-shadow:0 0 14px rgba(201,168,76,0.35)}
          50%{box-shadow:0 0 32px rgba(201,168,76,0.7),0 0 55px rgba(201,168,76,0.25)}
        }
        .spin-ready{animation:spinGlow 2s ease-in-out infinite}
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{width:'100%',background:'linear-gradient(180deg,#1a0800,#081a0c)',
        borderBottom:'2px solid #C9A84C',padding:'9px 14px',display:'flex',
        justifyContent:'space-between',alignItems:'center',boxSizing:'border-box'}}>
        <div>
          <div style={{fontSize:20,fontWeight:'bold',letterSpacing:4,color:'#C9A84C'}}>ROULETTE</div>
          <div style={{fontSize:9,color:'#555',letterSpacing:2}}>EUROPEAN · PRACTICE</div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>setShowStats(true)} style={{background:'transparent',
            border:'1px solid #555',color:'#888',padding:'5px 8px',borderRadius:4,
            cursor:'pointer',fontSize:11}}>統計</button>
          <button onClick={()=>setShowRules(true)} style={{background:'transparent',
            border:'1px solid #C9A84C',color:'#C9A84C',padding:'5px 10px',borderRadius:4,
            cursor:'pointer',fontSize:11,letterSpacing:1}}>ルール説明</button>
        </div>
      </div>

      <div style={{width:'100%',maxWidth:420,padding:'10px 12px',boxSizing:'border-box',
        display:'flex',flexDirection:'column',gap:9}}>

        {/* ── Balance ──────────────────────────────────────────────────── */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
          background:'rgba(0,0,0,0.45)',borderRadius:8,padding:'9px 14px',border:'1px solid #1a3a1a'}}>
          <div>
            <div style={{fontSize:9,color:'#555',letterSpacing:1}}>残高</div>
            <div style={{fontSize:22,fontWeight:'bold',color:'#C9A84C'}}>¥{bal.toLocaleString()}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {result&&(
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:8,color:'#555',marginBottom:2}}>直前の結果</div>
                <div style={{width:40,height:40,borderRadius:'50%',background:clrHex(result.c),
                  border:'2px solid #C9A84C',display:'flex',alignItems:'center',
                  justifyContent:'center',fontSize:14,fontWeight:'bold',color:'#FFF'}}>
                  {result.n}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Wheel Canvas ─────────────────────────────────────────────── */}
        <div style={{display:'flex',justifyContent:'center'}}>
          <canvas ref={cvs} width={BUF} height={BUF}
            style={{width:'min(268px,84vw)',height:'min(268px,84vw)',borderRadius:'50%',
              boxShadow:'0 0 44px rgba(201,168,76,0.2),0 0 80px rgba(0,0,0,0.65)'}}/>
        </div>

        {/* ── Chip Selector ────────────────────────────────────────────── */}
        <div>
          <div style={{fontSize:9,color:'#555',letterSpacing:1,marginBottom:4}}>チップを選ぶ</div>
          <div style={{display:'flex',gap:6}}>
            {CHIPS.map(c=>(
              <button key={c} onClick={()=>setChip(c)} style={{
                flex:1,padding:'7px 0',fontSize:11,fontWeight:'bold',cursor:'pointer',borderRadius:5,
                border:chip===c?'2px solid #FFD700':'2px solid #252525',
                background:chip===c?'rgba(201,168,76,0.18)':'rgba(0,0,0,0.4)',
                color:chip===c?'#FFD700':'#555'}}>
                ¥{c>=1000?`${c/1000}K`:c}
              </button>
            ))}
          </div>
        </div>

        {/* ── Betting Board ────────────────────────────────────────────── */}
        <div>
          <div style={{fontSize:9,color:'#555',letterSpacing:1,marginBottom:4}}>
            ベッティングボード
            {tb>0&&<span style={{color:'#C9A84C',marginLeft:7}}>合計 ¥{tb.toLocaleString()}</span>}
          </div>

          {/* Number grid: [0 span3] | [12 cols] | [2:1 col] */}
          <div style={{display:'grid',
            gridTemplateColumns:'24px repeat(12,1fr) 24px',
            gridTemplateRows:'repeat(3,28px)',
            gap:1.5,marginBottom:1.5}}>
            <NC n={0} fullH />
            {/* Top row: 3,6,9,…,36 */}
            {Array.from({length:12},(_,i)=><NC key={`t${i}`} n={(i+1)*3}/>)}
            <BC k="c3" l="2:1" p={2} bg="#0a1b0a"/>
            {/* Mid row: 2,5,8,…,35 */}
            {Array.from({length:12},(_,i)=><NC key={`m${i}`} n={(i+1)*3-1}/>)}
            <BC k="c2" l="2:1" p={2} bg="#0a1b0a"/>
            {/* Bot row: 1,4,7,…,34 */}
            {Array.from({length:12},(_,i)=><NC key={`b${i}`} n={(i+1)*3-2}/>)}
            <BC k="c1" l="2:1" p={2} bg="#0a1b0a"/>
          </div>

          {/* Dozen row */}
          <div style={{display:'grid',gridTemplateColumns:'24px repeat(12,1fr) 24px',
            gap:1.5,marginBottom:1.5,height:28}}>
            <div/><BC k="d1" l="1st 12" p={2} bg="#0e240e" cs={4}/>
            <BC k="d2" l="2nd 12" p={2} bg="#0e240e" cs={4}/>
            <BC k="d3" l="3rd 12" p={2} bg="#0e240e" cs={4}/><div/>
          </div>

          {/* Outside row */}
          <div style={{display:'grid',gridTemplateColumns:'24px repeat(6,1fr) 24px',
            gap:1.5,height:28}}>
            <div/>
            {OUTSIDE.map(o=><BC key={o.k} k={o.k} l={o.l} p={o.p} bg={o.bg}/>)}
            <div/>
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
          <button onClick={clearBets} disabled={spinning||!tb} style={{
            padding:'9px 0',background:'rgba(70,0,0,0.4)',border:'1px solid #3a0000',
            borderRadius:6,color:'#FF6666',cursor:'pointer',fontSize:12,fontWeight:'bold',
            opacity:(spinning||!tb)?0.35:1}}>クリア</button>
          <button onClick={doubleBets} disabled={spinning||!tb} style={{
            padding:'9px 0',background:'rgba(0,50,0,0.4)',border:'1px solid #003800',
            borderRadius:6,color:'#66FF88',cursor:'pointer',fontSize:12,fontWeight:'bold',
            opacity:(spinning||!tb)?0.35:1}}>× 2 倍</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1.6fr 1fr',gap:6}}>
          <button onClick={rebet} disabled={spinning||!lastBets||sumB(lastBets)>bal} style={{
            padding:'11px 0',background:'rgba(30,30,80,0.5)',border:'1px solid #334',
            borderRadius:6,color:'#AAAAFF',cursor:'pointer',fontSize:12,fontWeight:'bold',
            opacity:(spinning||!lastBets)?0.35:1}}>リベット</button>
          <button onClick={spin} disabled={spinning||!tb}
            className={(!spinning&&tb)?'spin-ready':''}
            style={{padding:'11px 0',fontSize:16,fontWeight:'bold',borderRadius:6,cursor:'pointer',
              border:`2px solid ${spinning?'#444':'#C9A84C'}`,
              background:spinning?'#1a1a1a':'linear-gradient(135deg,#C9A84C,#8B6914)',
              color:spinning?'#555':'#000',
              opacity:(!tb&&!spinning)?0.35:1}}>
            {spinning?'🎡 回転中…':'▶ SPIN'}
          </button>
          {bal<chip&&!spinning?(
            <button onClick={()=>{setBal(10000);setResult(null);setHist([]);setBets({});setLastBets(null);}}
              style={{padding:'11px 0',background:'rgba(201,168,76,0.15)',border:'1px solid #C9A84C',
                borderRadius:6,color:'#C9A84C',cursor:'pointer',fontSize:11,fontWeight:'bold'}}>
              リセット
            </button>
          ):(()=>{
            const net=result?(result.w-sumB(lastBets||{})):null;
            return(
              <div style={{padding:'11px 4px',background:'rgba(20,40,20,0.3)',border:'1px solid #1a3a1a',
                borderRadius:6,fontSize:11,fontWeight:'bold',textAlign:'center',
                display:'flex',alignItems:'center',justifyContent:'center',
                color:net==null?'#2a4a2a':net>0?'#66FF88':net<0?'#FF6666':'#888'}}>
                {net==null?'—':net>=0?`+¥${net.toLocaleString()}`:`-¥${Math.abs(net).toLocaleString()}`}
              </div>
            );
          })()}
        </div>

        {/* ── History ──────────────────────────────────────────────────── */}
        {hist.length>0&&(
          <div>
            <div style={{fontSize:9,color:'#444',letterSpacing:1,marginBottom:4}}>直近の結果（新しい順）</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
              {hist.map((h,i)=>(
                <div key={i} title={`${h.n}: ${h.net>=0?'+':''}¥${h.net.toLocaleString()}`} style={{
                  width:24,height:24,borderRadius:'50%',background:clrHex(h.c),
                  border:h.net>0?'1.5px solid #FFD700':'1.5px solid #2a2a2a',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:8,fontWeight:'bold',color:'#FFF'}}>
                  {h.n}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast&&(
        <div style={{position:'fixed',top:65,left:'50%',transform:'translateX(-50%)',
          background:toast.t==='w'?'rgba(0,68,20,0.97)':toast.t==='l'?'rgba(68,0,0,0.97)':'rgba(12,12,12,0.95)',
          border:`1px solid ${toast.t==='w'?'#00AA44':toast.t==='l'?'#AA0000':'#444'}`,
          color:'#FFF',padding:'9px 18px',borderRadius:8,fontSize:13,fontWeight:'bold',
          zIndex:100,textAlign:'center',maxWidth:'88vw',
          boxShadow:'0 4px 20px rgba(0,0,0,0.75)',whiteSpace:'nowrap'}}>
          {toast.m}
        </div>
      )}

      {/* ── Stats Modal ──────────────────────────────────────────────────── */}
      {showStats&&(()=>{
        const total=hist.length;
        const wins=hist.filter(h=>h.net>0).length;
        const reds=hist.filter(h=>h.c==='r').length;
        const blks=hist.filter(h=>h.c==='b').length;
        const grns=hist.filter(h=>h.c==='g').length;
        const netTotal=hist.reduce((a,h)=>a+h.net,0);
        // Hot numbers (most frequent in last 20)
        const freq={};
        hist.forEach(h=>{freq[h.n]=(freq[h.n]||0)+1;});
        const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5);
        return(
          <div onClick={e=>e.target===e.currentTarget&&setShowStats(false)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:200,
              display:'flex',alignItems:'flex-start',justifyContent:'center',
              overflowY:'auto',padding:'16px 12px',boxSizing:'border-box'}}>
            <div style={{background:'#060f08',border:'2px solid #C9A84C',borderRadius:12,
              padding:'18px',maxWidth:420,width:'100%',color:'#CCC',fontSize:13}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <h2 style={{margin:0,color:'#C9A84C',fontSize:17}}>📊 セッション統計</h2>
                <button onClick={()=>setShowStats(false)}
                  style={{background:'none',border:'none',color:'#666',fontSize:24,cursor:'pointer',lineHeight:1,padding:0}}>×</button>
              </div>
              {total===0?(
                <p style={{color:'#555',textAlign:'center',padding:'20px 0'}}>まだデータがありません。SPINしてください。</p>
              ):(
                <>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                    {[
                      {label:'総スピン',val:`${total} 回`},
                      {label:'勝率',val:`${total?Math.round(wins/total*100):0}%`},
                      {label:'純損益',val:`${netTotal>=0?'+':''}¥${netTotal.toLocaleString()}`,color:netTotal>=0?'#66FF88':'#FF6666'},
                      {label:'現在残高',val:`¥${bal.toLocaleString()}`,color:'#C9A84C'},
                    ].map(({label,val,color})=>(
                      <div key={label} style={{background:'rgba(0,0,0,0.35)',borderRadius:8,padding:'10px 12px'}}>
                        <div style={{fontSize:9,color:'#555',letterSpacing:1,marginBottom:3}}>{label}</div>
                        <div style={{fontSize:18,fontWeight:'bold',color:color||'#FFF'}}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'10px 12px',marginBottom:10}}>
                    <div style={{fontSize:11,color:'#888',marginBottom:8}}>色の分布（直近{total}回）</div>
                    <div style={{display:'flex',gap:4,alignItems:'center',marginBottom:6}}>
                      <div style={{width:`${total?reds/total*100:33}%`,height:18,background:'#BB2000',borderRadius:3,minWidth:4,transition:'width 0.5s'}}/>
                      <div style={{width:`${total?blks/total*100:33}%`,height:18,background:'#333',borderRadius:3,minWidth:4,transition:'width 0.5s'}}/>
                      <div style={{width:`${total?grns/total*100:34}%`,height:18,background:'#007A3D',borderRadius:3,minWidth:4,transition:'width 0.5s'}}/>
                    </div>
                    <div style={{display:'flex',gap:12,fontSize:11,color:'#888'}}>
                      <span>🔴 赤 {reds}回</span>
                      <span>⚫ 黒 {blks}回</span>
                      <span>🟢 緑 {grns}回</span>
                    </div>
                  </div>
                  {sorted.length>0&&(
                    <div style={{background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:11,color:'#888',marginBottom:8}}>よく出た番号（直近{total}回）</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {sorted.map(([n,cnt])=>(
                          <div key={n} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                            <div style={{width:32,height:32,borderRadius:'50%',
                              background:clrHex(getClr(parseInt(n))),
                              border:'1.5px solid #C9A84C',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:11,fontWeight:'bold',color:'#FFF'}}>
                              {n}
                            </div>
                            <span style={{fontSize:9,color:'#C9A84C'}}>{cnt}回</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              <button onClick={()=>setShowStats(false)} style={{width:'100%',marginTop:14,padding:'11px',
                background:'linear-gradient(135deg,#C9A84C,#8B6914)',border:'none',borderRadius:6,
                color:'#000',fontWeight:'bold',fontSize:14,cursor:'pointer'}}>
                閉じる
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Rules Modal ──────────────────────────────────────────────────── */}
      {showRules&&(
        <div onClick={e=>e.target===e.currentTarget&&setShowRules(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:200,
            display:'flex',alignItems:'flex-start',justifyContent:'center',
            overflowY:'auto',padding:'16px 12px',boxSizing:'border-box'}}>
          <div style={{background:'#060f08',border:'2px solid #C9A84C',borderRadius:12,
            padding:'18px',maxWidth:420,width:'100%',color:'#CCC',fontSize:13,lineHeight:1.75}}>

            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <h2 style={{margin:0,color:'#C9A84C',fontSize:17}}>🎡 ルーレット ルール</h2>
              <button onClick={()=>setShowRules(false)}
                style={{background:'none',border:'none',color:'#666',fontSize:24,cursor:'pointer',lineHeight:1,padding:0}}>×</button>
            </div>

            {[
              {title:'📋 概要', body:(
                <p style={{margin:'0 0 14px'}}>
                  ヨーロピアンルーレット（シングルゼロ）。<strong style={{color:'#FFF'}}>0〜36の37マス</strong>があり、回転するボールが止まった番号でベットの勝敗が決まります。ハウスエッジは約 <strong style={{color:'#FFF'}}>2.70%</strong>（アメリカン版の5.26%より有利）。
                </p>
              )},
              {title:'🎲 ベットの種類と配当', body:(
                <>
                  <div style={{background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
                    <div style={{color:'#FFD700',fontWeight:'bold',fontSize:12,marginBottom:6}}>インサイドベット（番号直接）</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',columnGap:12,rowGap:3,fontSize:12}}>
                      <span>ストレートアップ（1番号に直接）</span><span style={{color:'#C9A84C',fontWeight:'bold'}}>35 : 1</span>
                    </div>
                  </div>
                  <div style={{background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'10px 12px',marginBottom:14}}>
                    <div style={{color:'#FFD700',fontWeight:'bold',fontSize:12,marginBottom:6}}>アウトサイドベット</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',columnGap:12,rowGap:4,fontSize:12}}>
                      <span>赤 / 黒</span>          <span style={{color:'#C9A84C',fontWeight:'bold'}}>1 : 1</span>
                      <span>奇数 / 偶数</span>       <span style={{color:'#C9A84C',fontWeight:'bold'}}>1 : 1</span>
                      <span>ロー（1〜18） / ハイ（19〜36）</span><span style={{color:'#C9A84C',fontWeight:'bold'}}>1 : 1</span>
                      <span>ダズン（1st / 2nd / 3rd 12）</span><span style={{color:'#C9A84C',fontWeight:'bold'}}>2 : 1</span>
                      <span>コラム（縦列 2:1 ボタン）</span>   <span style={{color:'#C9A84C',fontWeight:'bold'}}>2 : 1</span>
                    </div>
                  </div>
                </>
              )},
              {title:'⚠️ ゼロ（0）のルール', body:(
                <p style={{margin:'0 0 14px'}}>
                  0が出るとアウトサイドベット（赤/黒・奇数/偶数・ハイ/ロー）はすべて<strong style={{color:'#FF6666'}}>負け</strong>になります。0に直接ベットした場合のみ <strong style={{color:'#FFF'}}>35:1</strong> の配当が得られます。
                </p>
              )},
              {title:'🎮 遊び方', body:(
                <ol style={{margin:'0 0 14px',paddingLeft:18,fontSize:13}}>
                  <li>チップ（¥100〜¥5,000）を選ぶ</li>
                  <li>ベッティングボードをタップしてベットを置く<br/>
                    <span style={{fontSize:11,color:'#777'}}>※同じマスを複数回タップで追加ベット可</span></li>
                  <li>「▶ SPIN」ボタンを押す</li>
                  <li>ボールが止まった番号で配当が確定する</li>
                </ol>
              )},
              {title:'🔘 ボタン説明', body:(
                <ul style={{margin:'0 0 14px',paddingLeft:18,fontSize:13}}>
                  <li><strong style={{color:'#FF9999'}}>クリア</strong>：全ベットを取り消す</li>
                  <li><strong style={{color:'#99FF99'}}>× 2</strong>：現在の全ベットを2倍にする</li>
                  <li>履歴の<span style={{color:'#FFD700'}}>金枠</span>は勝ち、<span style={{color:'#444'}}>暗枠</span>は負け</li>
                  <li><strong style={{color:'#C9A84C'}}>リセット</strong>：残高が不足したとき残高を¥10,000に戻す</li>
                </ul>
              )},
            ].map(({title,body})=>(
              <section key={title}>
                <h3 style={{color:'#C9A84C',fontSize:13,margin:'0 0 6px'}}>{title}</h3>
                {body}
              </section>
            ))}

            <div style={{padding:'9px 12px',background:'rgba(201,168,76,0.07)',
              border:'1px solid rgba(201,168,76,0.2)',borderRadius:8,
              fontSize:11,color:'#555',lineHeight:1.6,marginBottom:14}}>
              ※ セブ旅行の練習アプリです。初期残高 ¥10,000 の架空マネーでお楽しみください。
            </div>

            <button onClick={()=>setShowRules(false)} style={{width:'100%',padding:'12px',
              background:'linear-gradient(135deg,#C9A84C,#8B6914)',border:'none',borderRadius:6,
              color:'#000',fontWeight:'bold',fontSize:14,cursor:'pointer'}}>
              わかった！練習する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
