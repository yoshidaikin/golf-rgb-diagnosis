
const PRESETS = {
  "ベント芝": {vari:0.055, gli:0.095, exg:0.135, pct:18},
  "コウライ芝": {vari:0.010, gli:0.045, exg:0.070, pct:14},
  "ティフトン・バミューダ": {vari:-0.005, gli:0.035, exg:0.055, pct:12}
};
const MAX_SIDE = 1200;
const $ = id => document.getElementById(id);
let img = null, baseCanvas = document.createElement("canvas");
let crop = {x:0,y:0,w:0,h:0}, drag=null;
let resultOriginal=null, resultOverlay=null;
let lastMetrics=null;
let currentSourceFileName="";

$("useMeta").addEventListener("change", ()=>{$("metaFields").classList.toggle("hidden", !$("useMeta").checked);});
$("shootDate").value = new Date().toISOString().slice(0,10);

function safeName(v){return String(v||"").trim().replace(/[\\/:*?"<>|]/g,"_").replace(/\s+/g,"_").slice(0,80);}
function buildSaveName(){
  if(!$("useMeta").checked) return "芝生_RGB簡易診断.png";
  return [
    safeName($("courseName").value)||"ゴルフ場名未入力",
    $("shootDate").value||new Date().toISOString().slice(0,10),
    safeName($("targetName").value)||"対象名未入力",
    safeName($("species").value),
    safeName($("mode").value)
  ].join("_")+"_簡易診断.png";
}
function overlayRgb(){
  return {amber:[255,140,0],yellow:[255,215,0],magenta:[180,0,180],red:[255,0,0]}[$("overlayColor").value]||[255,140,0];
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function percentile(a,p){
  const b = Array.from(a).sort((x,y)=>x-y);
  if(!b.length) return 0;
  const i=(b.length-1)*p/100, lo=Math.floor(i), hi=Math.ceil(i);
  return b[lo] + (b[hi]-b[lo])*(i-lo);
}
function gaussianBlur(src,w,h,r){
  // 軽量な3回ボックスブラー（ガウシアン近似）
  let a=src, b=new Float32Array(src.length);
  const pass=(s,d,rad)=>{
    for(let y=0;y<h;y++){
      let sum=0;
      for(let x=-rad;x<=rad;x++) sum+=s[y*w+clamp(x,0,w-1)];
      for(let x=0;x<w;x++){
        d[y*w+x]=sum/(2*rad+1);
        sum+=s[y*w+clamp(x+rad+1,0,w-1)]-s[y*w+clamp(x-rad,0,w-1)];
      }
    }
    for(let x=0;x<w;x++){
      let sum=0;
      for(let y=-rad;y<=rad;y++) sum+=d[clamp(y,0,h-1)*w+x];
      for(let y=0;y<h;y++){
        s[y*w+x]=sum/(2*rad+1);
        sum+=d[clamp(y+rad+1,0,h-1)*w+x]-d[clamp(y-rad,0,h-1)*w+x];
      }
    }
  };
  a=new Float32Array(src);
  const rad=Math.max(1,Math.floor(r/3));
  for(let i=0;i<3;i++) pass(a,b,rad);
  return a;
}
function rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d){ if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=30; if(h<0)h+=180;}
  const s=mx===0?0:d/mx;
  return [h,s*255,mx*255];
}
function setStatus(t){$("status").textContent=t}
async function loadSelectedImageFile(f){
  if(!f)return;
  try{
    currentSourceFileName=f.name||"camera.jpg";
    setStatus("画像を読み込んでいます…");
    const bmp=await createImageBitmap(f);
    const scale=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height));
    baseCanvas.width=Math.max(1,Math.round(bmp.width*scale));
    baseCanvas.height=Math.max(1,Math.round(bmp.height*scale));
    baseCanvas.getContext("2d").drawImage(bmp,0,0,baseCanvas.width,baseCanvas.height);
    img=baseCanvas;
    resetCrop();
    drawCrop();
    $("cropSection").classList.remove("hidden");
    $("resultSection").classList.add("hidden");
    setStatus(`読込完了：${baseCanvas.width} × ${baseCanvas.height}px`);
  }catch(err){
    console.error(err);
    setStatus("画像を読み込めませんでした。別の画像形式でお試しください。");
    alert("画像読込エラー："+err.message);
  }
}
$("file").addEventListener("change", e=>loadSelectedImageFile(e.target.files?.[0]));
$("cameraFile").addEventListener("change", e=>loadSelectedImageFile(e.target.files?.[0]));
function resetCrop(){
  crop={x:baseCanvas.width*.1,y:baseCanvas.height*.1,w:baseCanvas.width*.8,h:baseCanvas.height*.8};
}
function drawCrop(){
  const c=$("cropCanvas"), maxW=c.parentElement.clientWidth;
  c.width=baseCanvas.width; c.height=baseCanvas.height;
  const x=c.getContext("2d");
  x.drawImage(baseCanvas,0,0);
  x.fillStyle="rgba(0,0,0,.45)"; x.fillRect(0,0,c.width,c.height);
  x.save(); x.beginPath(); x.rect(crop.x,crop.y,crop.w,crop.h); x.clip(); x.drawImage(baseCanvas,0,0); x.restore();
  x.strokeStyle="#00ff66"; x.lineWidth=Math.max(4,c.width/220); x.strokeRect(crop.x,crop.y,crop.w,crop.h);
  x.fillStyle="#00ff66";
  [[crop.x,crop.y],[crop.x+crop.w,crop.y],[crop.x,crop.y+crop.h],[crop.x+crop.w,crop.y+crop.h]].forEach(p=>{x.beginPath();x.arc(p[0],p[1],Math.max(9,c.width/90),0,Math.PI*2);x.fill()});
}
function pos(ev,c){
  const r=c.getBoundingClientRect(), t=ev.touches?.[0]||ev;
  return {x:(t.clientX-r.left)*c.width/r.width,y:(t.clientY-r.top)*c.height/r.height};
}
function hit(p){
  const hs=Math.max(35,baseCanvas.width/18);
  const corners=[["tl",crop.x,crop.y],["tr",crop.x+crop.w,crop.y],["bl",crop.x,crop.y+crop.h],["br",crop.x+crop.w,crop.y+crop.h]];
  for(const [n,x,y] of corners) if(Math.hypot(p.x-x,p.y-y)<hs)return n;
  if(p.x>=crop.x&&p.x<=crop.x+crop.w&&p.y>=crop.y&&p.y<=crop.y+crop.h)return "move";
  return null;
}
const cropCanvas=$("cropCanvas");
["pointerdown"].forEach(n=>cropCanvas.addEventListener(n,e=>{e.preventDefault();const p=pos(e,cropCanvas);drag={type:hit(p),sx:p.x,sy:p.y,start:{...crop}};cropCanvas.setPointerCapture(e.pointerId)}));
cropCanvas.addEventListener("pointermove",e=>{
  if(!drag?.type)return; const p=pos(e,cropCanvas), dx=p.x-drag.sx,dy=p.y-drag.sy,s=drag.start,min=100;
  if(drag.type==="move"){crop.x=clamp(s.x+dx,0,baseCanvas.width-s.w);crop.y=clamp(s.y+dy,0,baseCanvas.height-s.h)}
  if(drag.type==="tl"){let nx=clamp(s.x+dx,0,s.x+s.w-min),ny=clamp(s.y+dy,0,s.y+s.h-min);crop={x:nx,y:ny,w:s.x+s.w-nx,h:s.y+s.h-ny}}
  if(drag.type==="tr"){let nx=clamp(s.x+s.w+dx,s.x+min,baseCanvas.width),ny=clamp(s.y+dy,0,s.y+s.h-min);crop={x:s.x,y:ny,w:nx-s.x,h:s.y+s.h-ny}}
  if(drag.type==="bl"){let nx=clamp(s.x+dx,0,s.x+s.w-min),ny=clamp(s.y+s.h+dy,s.y+min,baseCanvas.height);crop={x:nx,y:s.y,w:s.x+s.w-nx,h:ny-s.y}}
  if(drag.type==="br"){let nx=clamp(s.x+s.w+dx,s.x+min,baseCanvas.width),ny=clamp(s.y+s.h+dy,s.y+min,baseCanvas.height);crop={x:s.x,y:s.y,w:nx-s.x,h:ny-s.y}}
  drawCrop();
});
cropCanvas.addEventListener("pointerup",()=>drag=null);
$("resetBtn").onclick=()=>{resetCrop();drawCrop()};
$("fullBtn").onclick=()=>{crop={x:0,y:0,w:baseCanvas.width,h:baseCanvas.height};drawCrop()};

$("analyzeBtn").onclick=()=>{
  try{
    $("analyzeBtn").disabled=true; setStatus("解析中…");
    setTimeout(runAnalysis,30);
  }catch(e){setStatus("解析エラー："+e.message);$("analyzeBtn").disabled=false}
};

function runAnalysis(){
  const w=Math.round(crop.w), h=Math.round(crop.h);
  const work=document.createElement("canvas"); work.width=w; work.height=h;
  const ctx=work.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(baseCanvas,crop.x,crop.y,crop.w,crop.h,0,0,w,h);
  const im=ctx.getImageData(0,0,w,h), d=im.data, n=w*h;
  let vari=new Float32Array(n),gli=new Float32Array(n),exg=new Float32Array(n), val=new Float32Array(n), sat=new Float32Array(n);
  let vegetation=new Uint8Array(n), shadow=new Uint8Array(n), sand=new Uint8Array(n), analysis=new Uint8Array(n), brown=new Uint8Array(n);
  const mode=$("mode").value, species=$("species").value, top=$("topdress").value, pre=PRESETS[species];
  for(let i=0,j=0;i<n;i++,j+=4){
    const r=d[j],g=d[j+1],b=d[j+2], total=r+g+b||1;
    vari[i]=clamp((g-r)/((g+r-b)||1e-6),-1,1);
    gli[i]=clamp((2*g-r-b)/((2*g+r+b)||1e-6),-1,1);
    exg[i]=clamp(2*g/total-r/total-b/total,-1,1);
    const [hh,ss,vv]=rgbToHsv(r,g,b); sat[i]=ss; val[i]=vv;
    // 黄褐色～褐色の簡易候補。日照条件の影響を受けるため、単独では判定しない。
    brown[i]=((r>g*0.92)&&(g>b*1.03)&&(r>b*1.12)&&(ss>18)&&(vv>35))?1:0;
    let ok=false;
    if(mode==="スマホ近距離撮影") ok=vv>=18&&vv<=250&&ss>=4;
    else if(mode==="スマホ中距離撮影") ok=g>=r-22&&g>=b-24&&hh>=12&&hh<=112&&ss>=6&&vv>=22;
    else ok=g>=r-15&&g>=b-18&&hh>=15&&hh<=108&&ss>=9&&vv>=24;
    vegetation[i]=ok?1:0;
  }
  const radius=mode==="スマホ近距離撮影"?5:mode==="スマホ中距離撮影"?4:3;
  vari=gaussianBlur(vari,w,h,radius); gli=gaussianBlur(gli,w,h,radius); exg=gaussianBlur(exg,w,h,radius);
  const local=gaussianBlur(val,w,h,mode==="ドローン撮影"?24:mode==="スマホ中距離撮影"?18:12);
  const ratioLimit=mode==="ドローン撮影"?.66:mode==="スマホ中距離撮影"?.54:.42;
  const absLimit=mode==="ドローン撮影"?95:mode==="スマホ中距離撮影"?72:48;
  let vegCount=0,shadowCount=0,sandCount=0,analysisCount=0,brownCount=0;
  for(let i=0;i<n;i++){
    if(!vegetation[i])continue; vegCount++;
    const ratio=val[i]/(local[i]+1e-6);
    shadow[i]=((ratio<ratioLimit&&val[i]<absLimit)||(val[i]<absLimit*.70&&sat[i]<180))?1:0;
    if(shadow[i])shadowCount++;
    if(top!=="なし"){
      const lim=top==="薄目砂"?[205,75]:top==="散布直後"?[185,90]:[170,105];
      sand[i]=(val[i]>=lim[0]&&sat[i]<=lim[1])?1:0;
      if(sand[i])sandCount++;
    }
    analysis[i]=(vegetation[i]&&!shadow[i]&&!sand[i])?1:0;
    if(analysis[i]){analysisCount++; if(brown[i])brownCount++;}
  }
  if(analysisCount<500) throw new Error("評価できる芝が少なすぎます。範囲や条件を見直してください。");
  const vv=[],gg=[],ee=[];
  for(let i=0;i<n;i++)if(analysis[i]){vv.push(vari[i]);gg.push(gli[i]);ee.push(exg[i])}
  const norm=(arr,vals)=>{
    const p5=percentile(vals,5),p95=percentile(vals,95),den=(p95-p5)||1;
    const o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=clamp((arr[i]-p5)/den,0,1);return o;
  };
  const nv=norm(vari,vv),ng=norm(gli,gg),ne=norm(exg,ee),scores=[];
  const score=new Float32Array(n),votes=new Uint8Array(n);
  for(let i=0;i<n;i++)if(analysis[i]){
    score[i]=.30*nv[i]+.35*ng[i]+.35*ne[i];
    votes[i]=(vari[i]<pre.vari)+(gli[i]<pre.gli)+(exg[i]<pre.exg);
    scores.push(score[i]);
  }
  const th=percentile(scores,pre.pct), low=new Uint8Array(n);
  let lowCount=0;
  for(let i=0;i<n;i++)if(analysis[i]){
    let isLow=species==="ベント芝"?(votes[i]>=2&&score[i]<=th):(score[i]<=th&&(votes[i]>=1||score[i]<th*.85));
    if(isLow){low[i]=1;lowCount++}
  }
  const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
  const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/a.length)};
  const variMean=mean(vv), gliMean=mean(gg), exgMean=mean(ee);
  const uniform=clamp(100*(1-mean([sd(vv),sd(gg),sd(ee)])/.20),0,100);
  const lowRate=lowCount/analysisCount*100, cover=vegCount/n*100;
  // 総合管理判定は後段のドライ指数と整合させるため、仮置き
  let grade="A";
  let gradeText="良好";
  let gradeColor="#2e7d32";

  const brownRate = brownCount / analysisCount * 100;
  // 芝種ごとの特性を踏まえたドライ指数（0～100）
  let dryIndex;
  if(species==="ベント芝"){
    dryIndex = 0.42*lowRate + 0.28*(100-uniform) + 0.20*clamp((0.07-variMean)*500,0,100) + 0.10*brownRate;
  }else if(species==="コウライ芝"){
    dryIndex = 0.25*lowRate + 0.38*(100-uniform) + 0.22*clamp((0.04-variMean)*700,0,100) + 0.15*brownRate;
  }else{
    dryIndex = 0.18*lowRate + 0.32*(100-uniform) + 0.30*clamp((0.055-variMean)*600,0,100) + 0.20*brownRate;
  }
  dryIndex = clamp(dryIndex,0,100);

  let dryStage;
  if(dryIndex < 18) dryStage="通常範囲";
  else if(dryIndex < 32) dryStage="要観察";
  else if(dryIndex < 48) dryStage="ドライ予兆";
  else if(dryIndex < 68) dryStage="初期ドライ";
  else dryStage="ドライ進行";

  // 管理判定をドライ段階と整合させる
  // 芝種ごとの芝目・刈込方向の影響で均一性だけが下がっても、単独でDにはしない
  if(dryStage==="通常範囲"){
    grade="A"; gradeText="良好"; gradeColor="#2e7d32";
  }else if(dryStage==="要観察"){
    grade="B"; gradeText="要観察"; gradeColor="#9a7b00";
  }else if(dryStage==="ドライ予兆"){
    grade="C"; gradeText="低活性・ドライ予兆"; gradeColor="#d66a00";
  }else{
    grade="D"; gradeText="ドライ反応強い"; gradeColor="#c62828";
  }

  // 補助的な安全側補正
  if(cover < 65 || variMean < -0.08){
    grade="D"; gradeText="ドライ反応強い"; gradeColor="#c62828";
  }else if((cover < 78 || uniform < 55) && grade==="A"){
    grade="B"; gradeText="要観察"; gradeColor="#9a7b00";
  }
  resultOriginal=ctx.getImageData(0,0,w,h);
  resultOverlay=new ImageData(new Uint8ClampedArray(resultOriginal.data),w,h);
  for(let i=0,j=0;i<n;i++,j+=4){
    if(!vegetation[i]){resultOverlay.data[j]*=.55;resultOverlay.data[j+1]*=.55;resultOverlay.data[j+2]*=.55}
    if(shadow[i]){resultOverlay.data[j]=245;resultOverlay.data[j+1]=245;resultOverlay.data[j+2]=245}
    else if(sand[i]){resultOverlay.data[j]=255;resultOverlay.data[j+1]=220;resultOverlay.data[j+2]=80}
    else if(low[i]){
      const oc=overlayRgb();
      resultOverlay.data[j]=Math.round(resultOverlay.data[j]*.25+oc[0]*.75);
      resultOverlay.data[j+1]=Math.round(resultOverlay.data[j+1]*.25+oc[1]*.75);
      resultOverlay.data[j+2]=Math.round(resultOverlay.data[j+2]*.25+oc[2]*.75);
    }
  }
  $("grade").textContent=grade;
  $("grade").style.color=gradeColor;
  $("gradeText").textContent=gradeText;
  $("lowRate").textContent=lowRate.toFixed(1)+"%";
  $("uniformity").textContent=uniform.toFixed(1);
  $("cover").textContent=cover.toFixed(1)+"%";
  $("variMean").textContent=variMean.toFixed(3);
  $("gliMean").textContent=gliMean.toFixed(3);
  $("dryIndex").textContent=dryIndex.toFixed(0)+"/100";
  $("dryStage").textContent=dryStage;
  const comment = dryStage==="通常範囲"
    ? "現時点では明確なドライ反応は少ない状態です。撮影条件を揃えて定期比較してください。"
    : dryStage==="要観察"
    ? "軽い水分ムラや芝目の影響を含む要観察段階です。散水後の変化を確認してください。"
    : dryStage==="ドライ予兆"
    ? "ドライ予兆の可能性があります。土壌水分、散水ムラ、撥水状態を早めに確認してください。"
    : dryStage==="初期ドライ"
    ? "初期ドライ反応が疑われます。散水だけで戻るか、浸透剤や根圏状態も確認してください。"
    : "ドライ反応が強く出ています。早めの散水対応と根圏・撥水状態の追加確認が必要です。";
  $("resultComment").textContent=comment;
  lastMetrics={grade,gradeText,lowRate,uniform,cover,variMean,gliMean,dryIndex,dryStage};
  $("teacherSection").classList.remove("hidden");
  const rc=$("resultCanvas");rc.width=w;rc.height=h;rc.getContext("2d").putImageData(resultOverlay,0,0);
  $("resultSection").classList.remove("hidden");$("resultSection").scrollIntoView({behavior:"smooth"});
  setStatus("診断が完了しました。");$("analyzeBtn").disabled=false;
}
$("showOriginal").onclick=()=>{if(resultOriginal)$("resultCanvas").getContext("2d").putImageData(resultOriginal,0,0)};
$("showOverlay").onclick=()=>{if(resultOverlay)$("resultCanvas").getContext("2d").putImageData(resultOverlay,0,0)};

function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  let line="", yy=y;
  for(const ch of Array.from(String(text||""))){
    const t=line+ch;
    if(ctx.measureText(t).width>maxWidth && line){ctx.fillText(line,x,yy);line=ch;yy+=lineHeight;}
    else line=t;
  }
  if(line)ctx.fillText(line,x,yy);
  return yy;
}
async function makeReportCanvas(){
  if(!resultOriginal || !resultOverlay || !lastMetrics) throw new Error("先に診断を実行してください。");

  const W=1200, margin=42, gap=24;
  const cardW=W-margin*2;
  const imageGap=20;
  const imageW=Math.floor((cardW-imageGap)/2);
  const imageH=500;
  const H=1140;

  const c=document.createElement("canvas");
  c.width=W; c.height=H;
  const ctx=c.getContext("2d");

  ctx.fillStyle="#f4f7f5";
  ctx.fillRect(0,0,W,H);

  // Header
  ctx.fillStyle="#1f4e3d";
  ctx.fillRect(0,0,W,118);
  ctx.fillStyle="#ffffff";
  ctx.font="bold 38px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText("ゴルフ場芝生 RGB簡易診断・相談用レポート",margin,52);
  ctx.font="22px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText("Ver.0.6.2",margin,88);

  const course=$("useMeta").checked?($("courseName").value||"－"):"－";
  const date=$("useMeta").checked?($("shootDate").value||"－"):"－";
  const target=$("useMeta").checked?($("targetName").value||"－"):"－";

  let y=145;

  // Metadata
  ctx.fillStyle="#ffffff";
  ctx.fillRect(margin,y,cardW,104);
  ctx.fillStyle="#1d2a24";
  ctx.font="bold 22px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText(`ゴルフ場：${course}`,margin+22,y+31);
  ctx.fillText(`撮影日：${date}　対象：${target}`,margin+22,y+62);
  ctx.fillText(`芝種：${$("species").value}　撮影：${$("mode").value}　目砂：${$("topdress").value}`,margin+22,y+91);
  y+=124;

  // Metrics card - place first for quick consultation
  ctx.fillStyle="#eaf2ee";
  ctx.fillRect(margin,y,cardW,174);

  const metricX1=margin+28, metricX2=margin+590;
  ctx.fillStyle="#1d2a24";
  ctx.font="bold 32px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText(`管理判定：${lastMetrics.grade}（${lastMetrics.gradeText}）`,metricX1,y+45);
  ctx.font="bold 28px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText(`ドライ指数：${lastMetrics.dryIndex.toFixed(0)}/100`,metricX2,y+45);

  ctx.font="23px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText(`ドライ段階：${lastMetrics.dryStage}`,metricX1,y+88);
  ctx.fillText(`低活性候補率：${lastMetrics.lowRate.toFixed(1)}%`,metricX2,y+88);
  ctx.fillText(`均一性：${lastMetrics.uniform.toFixed(1)}　芝抽出率：${lastMetrics.cover.toFixed(1)}%`,metricX1,y+130);
  ctx.fillText(`VARI：${lastMetrics.variMean.toFixed(3)}　GLI：${lastMetrics.gliMean.toFixed(3)}`,metricX2,y+130);
  y+=198;

  // Prepare source canvases
  const o=document.createElement("canvas");
  o.width=resultOriginal.width; o.height=resultOriginal.height;
  o.getContext("2d").putImageData(resultOriginal,0,0);

  const r=document.createElement("canvas");
  r.width=resultOverlay.width; r.height=resultOverlay.height;
  r.getContext("2d").putImageData(resultOverlay,0,0);

  function drawCover(src,x,y,w,h){
    const sw=src.width, sh=src.height;
    const scale=Math.max(w/sw,h/sh);
    const dw=sw*scale, dh=sh*scale;
    const dx=x+(w-dw)/2, dy=y+(h-dh)/2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
    ctx.drawImage(src,dx,dy,dw,dh);
    ctx.restore();
  }

  ctx.fillStyle="#1d2a24";
  ctx.font="bold 24px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText("元画像",margin,y);
  ctx.fillText("簡易診断画像",margin+imageW+imageGap,y);
  y+=14;

  drawCover(o,margin,y,imageW,imageH);
  drawCover(r,margin+imageW+imageGap,y,imageW,imageH);
  y+=imageH+26;

  // Notes
  ctx.fillStyle="#ffffff";
  ctx.fillRect(margin,y,cardW,122);
  ctx.fillStyle="#1d2a24";
  ctx.font="bold 22px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText("備考・現地確認",margin+20,y+31);
  ctx.font="21px 'Yu Gothic','Meiryo',sans-serif";
  wrapText(ctx,$("teacherNote")?.value||"なし",margin+20,y+64,cardW-40,28);

  ctx.fillStyle="#68736d";
  ctx.font="18px 'Yu Gothic','Meiryo',sans-serif";
  ctx.fillText("※病害・虫害・ドライの原因確定ではなく、相談・現地確認用の簡易レポートです。",margin,y+151);

  return c;
}

$("saveBtn").onclick=()=>{
  const a=document.createElement("a");a.download=buildSaveName();a.href=$("resultCanvas").toDataURL("image/png");a.click();
};
$("saveReportBtn").onclick=async()=>{
  try{
    const c=await makeReportCanvas();
    const a=document.createElement("a");
    a.download=buildSaveName().replace(/\.png$/,"_相談用レポート.jpg");
    a.href=c.toDataURL("image/jpeg",0.86);
    a.click();
  }catch(e){alert("レポート保存エラー："+e.message);}
};


$("trueLabel").addEventListener("change",()=>{
  const v=$("trueLabel").value;
  $("diseaseFields").classList.toggle("hidden", !(v==="病害疑い"||v==="病害確認"));
  $("insectFields").classList.toggle("hidden", !(v==="虫害疑い"||v==="虫害確認"));
});

// ---------- 教師データ保存（IndexedDB） ----------
const DB_NAME="turf_teacher_db";
const DB_VERSION=1;
const STORE_NAME="records";

function openTeacherDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE_NAME)){
        const st=db.createObjectStore(STORE_NAME,{keyPath:"id",autoIncrement:true});
        st.createIndex("createdAt","createdAt");
        st.createIndex("species","species");
        st.createIndex("trueLabel","trueLabel");
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function addTeacherRecord(record){
  const db=await openTeacherDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function getAllTeacherRecords(){
  const db=await openTeacherDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}

async function putTeacherRecord(record){
  const db=await openTeacherDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function fmtDate(v){
  if(!v)return "";
  try{return new Date(v).toLocaleString("ja-JP");}catch{return v}
}
async function renderTeacherDashboard(){
  const rows=await getAllTeacherRecords();
  $("teacherStatus").textContent=`登録件数：${rows.length}件`;

  const speciesList=["ベント芝","コウライ芝","ティフトン・バミューダ"];
  const labels=["正常","要観察","ドライ予兆","初期ドライ","進行ドライ","重度ドライ","病害疑い","病害確認","虫害疑い","虫害確認"];
  const summary=$("teacherSummary");
  summary.innerHTML="";
  for(const sp of speciesList){
    const total=rows.filter(r=>r.species===sp).length;
    const dry=rows.filter(r=>r.species===sp && ["ドライ予兆","初期ドライ","進行ドライ","重度ドライ"].includes(r.trueLabel)).length;
    const disease=rows.filter(r=>r.species===sp && ["病害疑い","病害確認"].includes(r.trueLabel)).length;
    const insect=rows.filter(r=>r.species===sp && ["虫害疑い","虫害確認"].includes(r.trueLabel)).length;
    const div=document.createElement("div");
    div.className="metric";
    div.innerHTML=`${sp}<b>${total}件</b><span>ドライ ${dry}／病害 ${disease}／虫害 ${insect}</span>`;
    summary.appendChild(div);
  }

  const body=$("teacherTable").querySelector("tbody");
  body.innerHTML="";
  for(const r of [...rows].sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,50)){
    const tr=document.createElement("tr");
    const detail=[r.diseaseName,r.insectName].filter(Boolean).join("・");
    tr.innerHTML=`
      <td style="border:1px solid #ccc;padding:6px">${String(r.id||"").padStart(4,"0")}</td>
      <td style="border:1px solid #ccc;padding:6px">${fmtDate(r.createdAt)}</td>
      <td style="border:1px solid #ccc;padding:6px">${r.species||""}</td>
      <td style="border:1px solid #ccc;padding:6px">${r.trueLabel||""}</td>
      <td style="border:1px solid #ccc;padding:6px">${Number(r.dryIndex||0).toFixed(0)}</td>
      <td style="border:1px solid #ccc;padding:6px">${detail}</td>`;
    body.appendChild(tr);
  }
}
async function clearTeacherRecords(){
  const db=await openTeacherDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function canvasToBlob(canvas,type="image/jpeg",quality=.9){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function csvEscape(v){
  const t=String(v??"");
  return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
}
async function updateTeacherCount(){ await renderTeacherDashboard(); }
$("registerTeacherBtn").addEventListener("click",async()=>{
  if(!lastMetrics || !resultOriginal){
    alert("先に画像を解析してください。"); return;
  }
  const trueLabel=$("trueLabel").value;
  if(!trueLabel){
    alert("現地確認結果を選択してください。"); return;
  }
  try{
    $("registerTeacherBtn").disabled=true;
    $("teacherStatus").textContent="登録中…";
    let imageBlob=null;
    if($("saveTeacherImage").checked){
      const c=document.createElement("canvas");
      c.width=resultOriginal.width;c.height=resultOriginal.height;
      c.getContext("2d").putImageData(resultOriginal,0,0);
      imageBlob=await canvasToBlob(c,"image/jpeg",.88);
    }
    const record={
      createdAt:new Date().toISOString(),
      courseName:$("useMeta").checked?$("courseName").value:"",
      shootDate:$("useMeta").checked?$("shootDate").value:"",
      targetName:$("useMeta").checked?$("targetName").value:"",
      sourceFile:currentSourceFileName||"",
      species:$("species").value,
      mode:$("mode").value,
      topdress:$("topdress").value,
      appGrade:lastMetrics.grade,
      appGradeText:lastMetrics.gradeText,
      lowRate:lastMetrics.lowRate,
      uniformity:lastMetrics.uniform,
      cover:lastMetrics.cover,
      variMean:lastMetrics.variMean,
      gliMean:lastMetrics.gliMean,
      dryIndex:lastMetrics.dryIndex,
      dryStage:lastMetrics.dryStage,
      trueLabel,
      diseaseName:$("diseaseName").value,
      insectName:$("insectName").value,
      afterWater:$("afterWater").value,
      confirmedDays:$("confirmedDays").value,
      note:$("teacherNote").value,
      hasImage:Boolean(imageBlob),
      imageBlob
    };
    await addTeacherRecord(record);
    $("teacherStatus").textContent="教師データへ登録しました。";
    await renderTeacherDashboard();
  }catch(e){
    $("teacherStatus").textContent="登録エラー："+e.message;
  }finally{
    $("registerTeacherBtn").disabled=false;
  }
});
$("exportCsvBtn").addEventListener("click",async()=>{
  const rows=await getAllTeacherRecords();
  if(!rows.length){alert("教師データがありません。");return;}
  const headers=["id","createdAt","courseName","shootDate","targetName","sourceFile","species","mode","topdress","appGrade","appGradeText","lowRate","uniformity","cover","variMean","gliMean","dryIndex","dryStage","trueLabel","diseaseName","insectName","afterWater","confirmedDays","note","hasImage"];
  const lines=[headers.join(",")];
  for(const r of rows) lines.push(headers.map(h=>csvEscape(r[h])).join(","));
  const bom="\uFEFF";
  downloadBlob(new Blob([bom+lines.join("\n")],{type:"text/csv;charset=utf-8"}),"芝生_教師データ.csv");
});
$("exportJsonBtn").addEventListener("click",async()=>{
  const rows=await getAllTeacherRecords();
  if(!rows.length){alert("教師データがありません。");return;}
  const out=[];
  for(const r of rows){
    const c={...r};
    if(c.imageBlob){
      c.imageDataUrl=await new Promise(resolve=>{
        const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.readAsDataURL(c.imageBlob);
      });
    }
    delete c.imageBlob;
    out.push(c);
  }
  downloadBlob(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}),"芝生_教師データ_バックアップ.json");
});

$("importJsonBtn").addEventListener("click",async()=>{
  const file=$("importJsonFile").files?.[0];
  if(!file){alert("バックアップJSONを選択してください。");return;}
  try{
    const text=await file.text();
    const rows=JSON.parse(text);
    if(!Array.isArray(rows))throw new Error("JSON形式が正しくありません。");
    for(const src of rows){
      const r={...src};
      if(r.imageDataUrl){
        const res=await fetch(r.imageDataUrl);
        r.imageBlob=await res.blob();
      }
      delete r.imageDataUrl;
      delete r.id; // 重複回避のため新しい番号を付与
      await addTeacherRecord(r);
    }
    await renderTeacherDashboard();
    alert(`${rows.length}件を復元しました。`);
  }catch(e){
    alert("復元エラー："+e.message);
  }
});

$("clearTeacherBtn").addEventListener("click",async()=>{
  if(!confirm("端末内の教師データをすべて削除します。よろしいですか？"))return;
  await clearTeacherRecords();
  await renderTeacherDashboard();
});
renderTeacherDashboard();

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
