'use strict';
const API='https://api.pokemontcg.io/v2/cards';
const $=id=>document.getElementById(id);
let worker=null, workerReady=null, stream=null, fx={rate:36.5,src:'fallback'};
const STOP=new Set('HP BASIC STAGE EVOLVES FROM POKEMON POKÉMON PSA GEM MINT MT NM EX VG GOOD TRAINER ENERGY ITEM SUPPORTER ABILITY WEAKNESS RESISTANCE RETREAT ILLUS DOUBLE RARE ULTRA SECRET ILLUSTRATION SPECIAL THE AND OF PROMO HOLO REVERSE JAPANESE ENGLISH CARD GAME SET'.split(' '));

/* ---------- OCR ---------- */
function initOCR(){
  if(!window.Tesseract){$('ocrStatus').textContent='OCR unavailable';return Promise.resolve(null)}
  workerReady=Tesseract.createWorker('eng').then(w=>{worker=w;$('ocrStatus').textContent='OCR ready';$('ocrStatus').classList.add('ok');return w})
   .catch(e=>{$('ocrStatus').textContent='OCR failed';console.error(e)});
  return workerReady;
}
function loadFX(){
  const c=JSON.parse(localStorage.getItem('fx')||'null');
  if(c&&Date.now()-c.t<12*3600e3){fx=c;return}
  fetch('https://open.er-api.com/v6/latest/USD').then(r=>r.json()).then(j=>{if(j.rates&&j.rates.THB){fx={rate:j.rates.THB,eur:j.rates.EUR,src:'open.er-api.com',t:Date.now()};localStorage.setItem('fx',JSON.stringify(fx))}}).catch(()=>{});
}
// draw source into canvas (max dim), return canvas
function toCanvas(src,w,h){const cv=document.createElement('canvas');const s=Math.min(1,1600/Math.max(w,h));cv.width=Math.round(w*s);cv.height=Math.round(h*s);
  const x=cv.getContext('2d');x.drawImage(src,0,0,cv.width,cv.height);return cv}
function crop(cv,y0,y1,x0=0,x1=1,scale=2){const c=document.createElement('canvas');const sw=cv.width*(x1-x0),sh=cv.height*(y1-y0);
  c.width=sw*scale;c.height=sh*scale;const x=c.getContext('2d');x.filter='grayscale(1) contrast(1.4)';x.drawImage(cv,cv.width*x0,cv.height*y0,sw,sh,0,0,c.width,c.height);return c}
async function ocrCanvas(cv){
  await workerReady; if(!worker) return {full:'',top:'',bottom:''};
  const r=async c=>(await worker.recognize(c)).data.text;
  const top=await r(crop(cv,0,0.2));
  const bl=await r(crop(cv,0.86,1,0,0.55,3));
  const br=await r(crop(cv,0.86,1,0.45,1,3));
  const bottom=bl+'\n'+br;
  const full=await r(cv);
  return {full,top,bottom};
}

/* ---------- Parsing ---------- */
function parseText(o,mode){
  const all=[o.top,o.bottom,o.full].join('\n');
  const res={raw:all,topText:mode==='psa'?o.full:o.top};
  const nm=all.match(/\b([A-Z]{0,4}\d{1,3}[a-z]?)\s*[\/⁄|]\s*([A-Z]{0,3}\d{2,3})\b/i);
  if(nm){res.number=nm[1].replace(/^0+(?=\d)/,'');res.total=nm[2].replace(/^0+(?=\d)/,'')}
  const g=all.match(/\b(GEM\s*M[TI]N?T?|MINT|NM[- ]?MT|NM|EX[- ]?MT|EX|VG[- ]?EX|VG|GOOD|FR|PR)\s*\+?\s*(10|[1-9](?:\.5)?)\b/i)||all.match(/\b(GEM\s*M[TI]N?T?|MINT|NM[- ]?MT|NM|EX[- ]?MT|EX|VG[- ]?EX|VG|GOOD|FR|PR|AUTHENTIC)\s*\+?\s*(10|[1-9](?:\.5)?)?\b/i);
  const cert=all.match(/\b(\d{8,10})\b/);
  const psaHint=/\bPSA\b|GEM\s*M|NM[- ]?MT|#\s*\d{1,3}\b/i.test(all);
  if(mode==='psa'||(mode!=='raw'&&psaHint&&(g||cert))){
    res.psa=true;
    if(g&&g[2])res.grade=`${g[1].toUpperCase().replace(/\s+/g,' ')} ${g[2]}`;else if(g)res.grade=g[1].toUpperCase();
    if(cert)res.cert=cert[1];
    const yr=all.match(/\b(19[9]\d|20[0-3]\d)\b/);if(yr)res.year=yr[1];
    if(!res.number){const h=all.match(/#\s*([A-Z]{0,4}\d{1,3})\b/i);if(h)res.number=h[1].replace(/^0+(?=\d)/,'')}
  }
  const words=s=>(s.match(/[A-Za-zÀ-ÿ'’.-]{3,}/g)||[]).map(w=>w.replace(/[’']s$/i,'').replace(/[^A-Za-zÀ-ÿ-]/g,'')).filter(w=>w.length>=3&&!STOP.has(w.toUpperCase()));
  const src=res.psa?all:(o.top+'\n'+o.full);
  const seen=new Set();res.words=words(src).filter(w=>{const k=w.toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
  return res;
}
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ');
const dist=(a,b)=>[...a].reduce((n,ch,i)=>n+(ch!==b[i]),0);
function score(card,p){
  const t=' '+norm(p.raw)+' ';let s=0;
  const toks=norm(card.name).split(' ').filter(x=>x.length>=2);
  const top=' '+norm(p.topText||'')+' ';
  toks.forEach(k=>{if(t.includes(' '+k+' ')||(k.length>=4&&t.includes(k)))s+=k.length>=3?3:1;if(k.length>=3&&top.includes(k))s+=2});
  if(p.number&&p.total&&card.number.length===p.number.length&&String(card.set.printedTotal).length===p.total.length)s+=0.5;
  if(p.number){const cn=card.number.toLowerCase(),pn=p.number.toLowerCase();if(cn===pn)s+=4;else if(cn.length===pn.length&&dist(cn,pn)<=1)s+=2}
  if(p.total){const ct=String(card.set.printedTotal);if(ct===p.total)s+=2;else if(ct.length===p.total.length&&dist(ct,p.total)<=1)s+=1}
  if(p.year&&card.set.releaseDate&&card.set.releaseDate.startsWith(p.year))s+=1;
  if(t.includes(norm(card.set.name).trim()))s+=2;
  return s;
}

/* ---------- API with cache ---------- */
async function q(query,size=30){
  const key='q:'+query,c=JSON.parse(localStorage.getItem(key)||'null');
  if(c&&Date.now()-c.t<6*3600e3)return c.d;
  const sel='id,name,number,rarity,set,images,tcgplayer,cardmarket';
  const url=`${API}?q=${encodeURIComponent(query)}&pageSize=${size}`;
  let r;for(let i=0;i<5;i++){try{r=await fetch(url);if(r.ok)break}catch(e){r=null}await new Promise(z=>setTimeout(z,300*(i+1)))}
  if(!r||!r.ok)throw new Error('API '+(r?r.status:'network'));const d=((await r.json()).data||[]).map(c=>({id:c.id,name:c.name,number:c.number,rarity:c.rarity,set:c.set,images:c.images,tcgplayer:c.tcgplayer,cardmarket:c.cardmarket}));
  try{localStorage.setItem(key,JSON.stringify({t:Date.now(),d}))}catch(e){pruneCache()}
  return d;
}
function pruneCache(){Object.keys(localStorage).filter(k=>k.startsWith('q:')).forEach(k=>localStorage.removeItem(k))}
const esc=s=>String(s).replace(/"/g,'');
async function findCards(p){
  const pool=new Map();const add=a=>a.forEach(c=>pool.set(c.id,c));
  const rank=()=>[...pool.values()].map(c=>({c,s:score(c,p)})).sort((a,b)=>b.s-a.s).filter(x=>x.s>0).slice(0,9);
  const run=async jobs=>(await Promise.allSettled(jobs)).forEach(r=>r.status==='fulfilled'&&add(r.value));
  const clean=w=>w.replace(/[^A-Za-z0-9-]/g,'');
  const cand=[...new Set([...p.words.filter(w=>w.length>=4).slice(0,2),...[...p.words].sort((a,b)=>b.length-a.length).slice(0,1)])].map(clean).filter(w=>w.length>=3);
  // stage 1: exact collector number (fast, precise)
  if(p.number&&p.total)await run([q(`number:"${esc(p.number)}" set.printedTotal:${p.total}`,50)]);
  else if(p.number&&p.psa&&cand[0])await run([q(`name:${cand[0]}* number:"${esc(p.number)}"`,30)]);
  let r=rank();if(r.length&&r[0].s>=9)return r;
  // stage 2: name words (top of card first)
  const jobs=cand.slice(0,2).map(w=>q(p.number?`name:${w}* number:"${esc(p.number)}"`:`name:${w}*`,p.number?30:40));
  await run(jobs);r=rank();if(r.length&&r[0].s>=7)return r;
  await run(cand.slice(0,2).filter(()=>p.number).map(w=>q(`name:${w}*`,60)));
  return rank();
}

/* ---------- UI ---------- */
const money=(v,cur='$')=>v==null||v===0?'—':cur+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const thb=v=>v?'฿'+Math.round(v*fx.rate).toLocaleString():'—';
function bestPrice(c){const p=c.tcgplayer&&c.tcgplayer.prices;if(p){for(const k of['holofoil','normal','1stEditionHolofoil','reverseHolofoil','unlimitedHolofoil','1stEdition','unlimited'])if(p[k]&&(p[k].market||p[k].mid))return{usd:p[k].market||p[k].mid,variant:k}}
  const cm=c.cardmarket&&c.cardmarket.prices;if(cm&&cm.trendPrice)return{usd:cm.trendPrice*(fx.eur?1/fx.eur:1.08),variant:'cardmarket (EUR→USD)'};return null}
function status(t){$('status').textContent=t}
function showMatches(list,p){
  $('matches').innerHTML='';
  if(list.length>1)list.forEach(({c})=>{const bp=bestPrice(c);const d=document.createElement('div');d.className='match';
    d.innerHTML=`<img loading="lazy" src="${c.images.small}" alt=""><div>${c.name}</div><div class="muted">${c.set.name} #${c.number}</div><b>${bp?money(bp.usd):'—'}</b>`;
    d.onclick=()=>{showResult(c,p);window.scrollTo({top:$('result').offsetTop-10,behavior:'smooth'})};$('matches').appendChild(d)});
}
function links(c,p){
  const base=`${c.name} ${c.number}/${c.set.printedTotal} ${c.set.name}`;
  const graded=p&&p.psa?` PSA ${(p.grade||'').match(/\d+(\.5)?/)?.[0]||''}`:'';
  const qq=encodeURIComponent((base+graded).trim());
  const L=[[`eBay SOLD${graded}`,`https://www.ebay.com/sch/i.html?_nkw=${qq}&LH_Sold=1&LH_Complete=1&_sop=13`],
   ['130point sold',`https://130point.com/sales/?search=${qq}`],
   ['PriceCharting',`https://www.pricecharting.com/search-products?q=${encodeURIComponent(c.name+' '+c.number)}&type=prices`],
   ['TCGplayer',c.tcgplayer?.url||`https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(c.name)}`]];
  if(p&&p.cert)L.unshift([`PSA cert #${p.cert}`,`https://www.psacard.com/cert/${p.cert}`]);
  return L.map(([t,u])=>`<a class="btn" target="_blank" rel="noopener" href="${u}">${t}</a>`).join('');
}
function showResult(c,p,save=true){
  const tp=c.tcgplayer?.prices||{},cm=c.cardmarket?.prices,bp=bestPrice(c);
  let rows=Object.entries(tp).map(([k,v])=>`<tr><td>${k}</td><td><b>${money(v.market)}</b></td><td>${money(v.low)}</td><td>${money(v.mid)}</td><td>${money(v.high)}</td></tr>`).join('');
  const psa=p&&p.psa?`<div class="grade">PSA ${p.grade||'grade ?'}${p.cert?' · cert '+p.cert:''}</div><div class="muted">Prices below are RAW (ungraded). Graded sold prices: tap eBay SOLD / 130point — no free graded-price API exists.</div>`:'';
  $('result').innerHTML=`<div class="card"><img src="${c.images.large||c.images.small}" alt="">
  <div class="info"><h2>${c.name}</h2><div class="muted">${c.set.name} (${c.set.series}) · #${c.number}/${c.set.printedTotal} · ${c.rarity||''}</div>${psa}
  <div class="big">${bp?money(bp.usd):'No price'}</div><div class="thb">${bp?thb(bp.usd):''}</div><div class="muted">${bp?bp.variant+' market':''} · 1 USD = ${fx.rate.toFixed(2)} THB</div></div>
  ${rows?`<table><tr class="muted"><td>TCGplayer</td><td>Market</td><td>Low</td><td>Mid</td><td>High</td></tr>${rows}</table><div class="muted">TCGplayer updated ${c.tcgplayer.updatedAt}</div>`:''}
  ${cm?`<table><tr class="muted"><td>Cardmarket (EUR)</td><td>Trend</td><td>Avg sell</td><td>30d avg</td><td>Low</td></tr><tr><td>normal</td><td><b>${money(cm.trendPrice,'€')}</b></td><td>${money(cm.averageSellPrice,'€')}</td><td>${money(cm.avg30,'€')}</td><td>${money(cm.lowPrice,'€')}</td></tr>${cm.reverseHoloTrend?`<tr><td>reverse</td><td>${money(cm.reverseHoloTrend,'€')}</td><td>${money(cm.reverseHoloSell,'€')}</td><td>${money(cm.reverseHoloAvg30,'€')}</td><td>${money(cm.reverseHoloLow,'€')}</td></tr>`:''}</table><div class="muted">Cardmarket updated ${c.cardmarket.updatedAt}</div>`:''}
  <div class="links">${links(c,p)}</div></div>`;
  if(save)addHistory(c,p,bp);
}
/* history */
const H=()=>JSON.parse(localStorage.getItem('hist')||'[]');
function addHistory(c,p,bp){const h=H().filter(x=>!(x.id===c.id&&x.grade===(p?.grade||'')));h.unshift({id:c.id,name:c.name,set:c.set.name,num:c.number,img:c.images.small,usd:bp?bp.usd:0,grade:p?.psa?(p.grade||'PSA'):'',t:Date.now()});
  localStorage.setItem('hist',JSON.stringify(h.slice(0,200)));renderHist()}
function renderHist(){const h=H();let tot=0;$('history').innerHTML=h.map((x,i)=>{tot+=x.usd||0;return `<div class="h" data-i="${i}"><img src="${x.img}" alt=""><div>${x.name}<div class="muted">${x.set} #${x.num} ${x.grade?'· '+x.grade:''}</div></div><div class="p">${money(x.usd)}<div class="muted">${thb(x.usd)}</div></div></div>`}).join('');
  $('total').textContent=h.length?`${h.length} cards · ${money(tot)} · ${thb(tot)}`:'';
  document.querySelectorAll('.h').forEach(el=>el.onclick=async()=>{const x=h[+el.dataset.i];const d=await q(`id:${x.id}`,1);if(d[0])showResult(d[0],x.grade?{psa:true,grade:x.grade}:null,false)})}

/* ---------- Pipeline ---------- */
async function processCanvas(cv){
  const t0=performance.now();$('matches').innerHTML='';$('result').innerHTML='';status('Reading card…');
  const o=await ocrCanvas(cv);const p=parseText(o,$('mode').value);
  $('ocrText').textContent=`Parsed: ${JSON.stringify({number:p.number,total:p.total,psa:p.psa,grade:p.grade,cert:p.cert,words:p.words.slice(0,8)})}\n---\n${p.raw}`;
  status('Looking up prices…');
  let list=[];try{list=await findCards(p)}catch(e){status('Price lookup failed: '+e.message);return {p,list}}
  const ms=Math.round(performance.now()-t0);
  if(!list.length){status(`No match (${ms} ms). Try again closer / better light, or type the name below.`);return {p,list}}
  showResult(list[0].c,p);showMatches(list,p);
  status(list.length>1?`Best match shown (${ms} ms) — tap another below if wrong.`:`Found in ${ms} ms`);
  window.__last={p,list:list.map(x=>({id:x.c.id,name:x.c.name,s:x.s}))};
  return {p,list};
}
async function startCam(){
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false});
    $('video').srcObject=stream;await $('video').play();$('camMsg').hidden=true;$('scanBtn').disabled=false;$('startCam').textContent='🔄 Restart';localStorage.setItem('camOK','1')}
  catch(e){$('camMsg').textContent='Camera blocked: '+e.message+' — use Upload';}
}
async function scan(){const v=$('video');if(!v.videoWidth)return;
  // crop to guide box (inset 6% / 14%)
  const w=v.videoWidth,h=v.videoHeight;const full=document.createElement('canvas');full.width=w;full.height=h;full.getContext('2d').drawImage(v,0,0);
  // object-fit cover: compute visible region then guide
  const el=v.getBoundingClientRect(),s=Math.max(el.width/w,el.height/h),vw=el.width/s,vh=el.height/s,ox=(w-vw)/2,oy=(h-vh)/2;
  const gx=ox+vw*0.14,gy=oy+vh*0.06,gw=vw*0.72,gh=vh*0.88;
  const c=document.createElement('canvas');const sc=Math.min(1,1600/Math.max(gw,gh));c.width=gw*sc;c.height=gh*sc;c.getContext('2d').drawImage(full,gx,gy,gw,gh,0,0,c.width,c.height);
  if(navigator.vibrate)navigator.vibrate(30);await processCanvas(c)}
async function fileToCanvas(f){const url=URL.createObjectURL(f);const img=new Image();img.src=url;await img.decode();const cv=toCanvas(img,img.naturalWidth,img.naturalHeight);URL.revokeObjectURL(url);return cv}
async function manual(text){$('matches').innerHTML='';$('result').innerHTML='';status('Searching…');
  const m=text.match(/^(.*?)\s*#?\s*([A-Z]{0,4}\d{1,3}[a-z]?)(?:\s*\/\s*(\d{2,3}))?\s*$/i);
  let name=text.trim(),num=null,tot=null;if(m&&m[1]){name=m[1].trim();num=m[2];tot=m[3]}
  let qs=`name:"*${esc(name)}*"`+(num?` number:"${num.replace(/^0+(?=\d)/,'')}"`:'')+(tot?` set.printedTotal:${tot}`:'');
  try{const d=await q(qs,24);if(!d.length){status('No results');return}
    status(`${d.length} result(s) — tap one`);if(d.length===1)showResult(d[0],null);showMatches(d.map(c=>({c})),null)}catch(e){status('Search failed: '+e.message)}}

window.addEventListener('load',()=>{
  initOCR();loadFX();renderHist();
  $('startCam').onclick=startCam;$('scanBtn').onclick=scan;
  $('file').onchange=async e=>{const f=e.target.files[0];if(f)await processCanvas(await fileToCanvas(f));e.target.value=''};
  $('searchForm').onsubmit=e=>{e.preventDefault();const v=$('q').value.trim();if(v)manual(v)};
  $('clearHist').onclick=()=>{if(confirm('Clear history?')){localStorage.removeItem('hist');renderHist()}};
  if(localStorage.getItem('camOK'))startCam();
});
window.CS={processCanvas,fileToCanvas,parseText,findCards,manual};
