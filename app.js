'use strict';
const API='https://api.pokemontcg.io/v2/cards';
const $=id=>document.getElementById(id);
let worker=null, workerReady=null, stream=null, fx={rate:33.5,eur:0.92,src:'fallback'};
const TDX='https://api.tcgdex.net/v2/en';
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
/* ---------- TCGdex (fast, fresh prices) ---------- */
const stripN=n=>String(n||'').replace(/^0+(?=\w)/,'').toLowerCase();
const mkey=c=>norm(c.name).trim()+'|'+stripN(c.number)+'|'+(c.set.printedTotal||'');
async function tdxJSON(path){const key='t:'+path,c=JSON.parse(localStorage.getItem(key)||'null');if(c&&Date.now()-c.t<6*3600e3)return c.d;
  const r=await fetch(TDX+path);if(!r.ok)throw new Error('TCGdex '+r.status);const d=await r.json();try{localStorage.setItem(key,JSON.stringify({t:Date.now(),d}))}catch(e){pruneCache()}return d}
function fromTdx(d){return{id:'tdx:'+d.id,tdxId:d.id,name:d.name,number:stripN(d.localId),rarity:d.rarity,src:'TCGdex',
  set:{name:d.set?.name||'',series:'',printedTotal:d.set?.cardCount?.official||'',releaseDate:''},
  images:{small:d.image?d.image+'/low.webp':'',large:d.image?d.image+'/high.webp':''},tdx:d.pricing||null}}
async function tdxFind(p,cand){
  const qs=[];
  if(p.number&&p.total)qs.push(`/cards?localId=${encodeURIComponent(p.number)}&set.cardCount.official=${p.total}`);
  cand.slice(0,2).forEach(w=>qs.push(p.number?`/cards?name=${encodeURIComponent(w)}&localId=${encodeURIComponent(p.number)}`:`/cards?name=${encodeURIComponent(w)}&pagination:itemsPerPage=30`));
  const briefs=new Map();(await Promise.allSettled(qs.map(tdxJSON))).forEach(r=>r.status==='fulfilled'&&Array.isArray(r.value)&&r.value.forEach(b=>briefs.set(b.id,b)));
  // pre-rank briefs, fetch details for top 6 only
  const pre=[...briefs.values()].map(b=>({b,s:score({name:b.name,number:stripN(b.localId),set:{printedTotal:p.total||'',name:''}},p)})).sort((x,y)=>y.s-x.s).slice(0,6);
  const full=await Promise.allSettled(pre.map(x=>tdxJSON('/cards/'+encodeURIComponent(x.b.id))));
  return full.filter(r=>r.status==='fulfilled').map(r=>fromTdx(r.value));
}
async function tdxPricingFor(c){ // attach TCGdex prices to a pokemontcg card
  if(c.tdx!==undefined)return c.tdx;
  try{const l=await tdxJSON(`/cards?name=${encodeURIComponent('eq:'+c.name)}&localId=${encodeURIComponent(c.number)}`);
    const hits=(Array.isArray(l)?l:[]).filter(b=>stripN(b.localId)===stripN(c.number));
    for(const b of hits.slice(0,4)){const d=await tdxJSON('/cards/'+encodeURIComponent(b.id));if(String(d.set?.cardCount?.official)===String(c.set.printedTotal)){c.tdx=d.pricing||null;c.tdxId=d.id;return c.tdx}}
  }catch(e){}
  c.tdx=null;return null}
const timeout=(pr,ms)=>Promise.race([pr,new Promise(r=>setTimeout(()=>r('__timeout'),ms))]);

async function ptcgFind(p,cand){
  const pool=new Map();const add=a=>a.forEach(c=>pool.set(c.id,c));
  const rank=()=>[...pool.values()].map(c=>({c,s:score(c,p)})).sort((a,b)=>b.s-a.s).filter(x=>x.s>0);
  const run=async jobs=>(await Promise.allSettled(jobs)).forEach(r=>r.status==='fulfilled'&&add(r.value));
  if(p.number&&p.total)await run([q(`number:"${esc(p.number)}" set.printedTotal:${p.total}`,50)]);
  else if(p.number&&p.psa&&cand[0])await run([q(`name:${cand[0]}* number:"${esc(p.number)}"`,30)]);
  let r=rank();if(r.length&&r[0].s>=9)return [...pool.values()];
  await run(cand.slice(0,2).map(w=>q(p.number?`name:${w}* number:"${esc(p.number)}"`:`name:${w}*`,p.number?30:40)));
  r=rank();if(r.length&&r[0].s>=7)return [...pool.values()];
  await run(cand.slice(0,2).filter(()=>p.number).map(w=>q(`name:${w}*`,60)));
  return [...pool.values()];
}
async function findCards(p){
  const clean=w=>w.replace(/[^A-Za-z0-9-]/g,'');
  const cand=[...new Set([...p.words.filter(w=>w.length>=4).slice(0,2),...[...p.words].sort((a,b)=>b.length-a.length).slice(0,1)])].map(clean).filter(w=>w.length>=3);
  const tP=tdxFind(p,cand).catch(()=>[]);const pP=ptcgFind(p,cand).catch(()=>[]);
  // TCGdex is usually <1s; give pokemontcg.io ~3s after TCGdex answers (or 3s total), then go with what we have
  const tdx=await timeout(tP,6000);const tdxList=tdx==='__timeout'?[]:tdx;
  let ptcg=await timeout(pP,tdxList.length?3000:8000);if(ptcg==='__timeout')ptcg=[];
  const merged=new Map();
  ptcg.forEach(c=>{c.src='pokemontcg.io';merged.set(mkey(c),c)});
  tdxList.forEach(t=>{const k=mkey(t),m=merged.get(k);if(m){m.tdx=t.tdx;m.tdxId=t.tdxId;m.src='pokemontcg.io + TCGdex'}else merged.set(k,t)});
  window.__srcStats={tdx:tdxList.length,ptcg:ptcg.length};
  return [...merged.values()].map(c=>({c,s:score(c,p)})).sort((a,b)=>b.s-a.s).filter(x=>x.s>0).slice(0,9);
}

/* ---------- UI ---------- */
const money=(v,cur='$')=>v==null||v===0?'—':cur+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const thb=v=>v?'฿'+Math.round(v*fx.rate).toLocaleString():'—';
function bestPrice(c){const tt=c.tdx&&c.tdx.tcgplayer;if(tt){for(const k of['holofoil','normal','reverse-holofoil','reverseHolofoil','1st-edition-holofoil','1st-edition','unlimited-holofoil'])if(tt[k]&&(tt[k].marketPrice||tt[k].midPrice))return{usd:tt[k].marketPrice||tt[k].midPrice,variant:k,src:'TCGdex→TCGplayer'};for(const[k,v]of Object.entries(tt))if(v&&v.marketPrice)return{usd:v.marketPrice,variant:k,src:'TCGdex→TCGplayer'}}
  const p=c.tcgplayer&&c.tcgplayer.prices;if(p){for(const k of['holofoil','normal','1stEditionHolofoil','reverseHolofoil','unlimitedHolofoil','1stEdition','unlimited'])if(p[k]&&(p[k].market||p[k].mid))return{usd:p[k].market||p[k].mid,variant:k,src:'pokemontcg.io→TCGplayer'}}
  const tcm=c.tdx&&c.tdx.cardmarket;if(!p&&tcm&&(tcm.trend||tcm.avg))return{usd:(tcm.trend||tcm.avg)/(fx.eur||0.92),variant:'cardmarket (EUR→USD)',src:'TCGdex→Cardmarket'};
  const cm=c.cardmarket&&c.cardmarket.prices;if(cm&&cm.trendPrice)return{usd:cm.trendPrice*(fx.eur?1/fx.eur:1.08),variant:'cardmarket (EUR→USD)',src:'pokemontcg.io→Cardmarket'};return null}
function status(t){$('status').textContent=t}
function showMatches(list,p){
  $('matches').innerHTML='';
  if(list.length>1)list.forEach(({c})=>{const bp=bestPrice(c);const d=document.createElement('div');d.className='match';
    d.innerHTML=`<img loading="lazy" src="${c.images.small}" alt=""><div>${c.name}</div><div class="muted">${c.set.name} #${c.number}</div><div class=src>${c.src||''}</div><b>${bp?money(bp.usd):'—'}</b>`;
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
  <div class="info"><h2>${c.name}</h2><div class="muted">${c.set.name} ${c.set.series?'('+c.set.series+')':''} · #${c.number}/${c.set.printedTotal} · ${c.rarity||''}</div>${psa}
  <div class="big">${bp?money(bp.usd):'No price'}</div><div class="thb">${bp?thb(bp.usd):''}</div><div class="muted">${bp?bp.variant+' market · source: '+bp.src:''} · 1 USD = ${fx.rate.toFixed(2)} THB</div></div>
  ${rows?`<table><tr class="muted"><td>TCGplayer <span class=src>via pokemontcg.io</span></td><td>Market</td><td>Low</td><td>Mid</td><td>High</td></tr>${rows}</table><div class="muted">TCGplayer updated ${c.tcgplayer.updatedAt}</div>`:''}
  ${cm?`<table><tr class="muted"><td>Cardmarket € <span class=src>via pokemontcg.io</span></td><td>Trend</td><td>Avg sell</td><td>30d avg</td><td>Low</td></tr><tr><td>normal</td><td><b>${money(cm.trendPrice,'€')}</b></td><td>${money(cm.averageSellPrice,'€')}</td><td>${money(cm.avg30,'€')}</td><td>${money(cm.lowPrice,'€')}</td></tr>${cm.reverseHoloTrend?`<tr><td>reverse</td><td>${money(cm.reverseHoloTrend,'€')}</td><td>${money(cm.reverseHoloSell,'€')}</td><td>${money(cm.reverseHoloAvg30,'€')}</td><td>${money(cm.reverseHoloLow,'€')}</td></tr>`:''}</table><div class="muted">Cardmarket updated ${c.cardmarket.updatedAt}</div>`:''}
  ${tdxTables(c)}<div class="muted" id="tdxNote">${c.tdx===undefined?'Checking TCGdex for fresher prices…':''}</div>
  <div class="links">${links(c,p)}</div></div>`;
  if(c.tdx===undefined)tdxPricingFor(c).then(()=>{if(window.__shown===c)showResult(c,p,false)});
  window.__shown=c;
  if(save)addHistory(c,p,bp);
}
function tdxTables(c){const t=c.tdx;if(!t)return '';let h='';
  const tp=t.tcgplayer;if(tp){const rows=Object.entries(tp).filter(([k,v])=>v&&typeof v==='object').map(([k,v])=>`<tr><td>${k}</td><td><b>${money(v.marketPrice)}</b></td><td>${money(v.lowPrice)}</td><td>${money(v.midPrice)}</td><td>${money(v.highPrice)}</td></tr>`).join('');
    if(rows)h+=`<table><tr class="muted"><td>TCGplayer <span class=src>via TCGdex</span></td><td>Market</td><td>Low</td><td>Mid</td><td>High</td></tr>${rows}</table><div class="muted">TCGdex/TCGplayer updated ${(tp.updated||'').slice(0,10)}</div>`}
  const cm=t.cardmarket;if(cm)h+=`<table><tr class="muted"><td>Cardmarket € <span class=src>via TCGdex</span></td><td>Trend</td><td>Avg</td><td>30d avg</td><td>Low</td></tr><tr><td>normal</td><td><b>${money(cm.trend,'€')}</b></td><td>${money(cm.avg,'€')}</td><td>${money(cm.avg30,'€')}</td><td>${money(cm.low,'€')}</td></tr>${cm['trend-holo']?`<tr><td>holo/rev</td><td>${money(cm['trend-holo'],'€')}</td><td>${money(cm['avg-holo'],'€')}</td><td>${money(cm['avg30-holo'],'€')}</td><td>${money(cm['low-holo'],'€')}</td></tr>`:''}</table><div class="muted">TCGdex/Cardmarket updated ${(cm.updated||'').slice(0,10)}</div>`;
  return h}
/* history */
const H=()=>JSON.parse(localStorage.getItem('hist')||'[]');
function addHistory(c,p,bp){const h=H().filter(x=>!(x.id===c.id&&x.grade===(p?.grade||'')));h.unshift({id:c.id,name:c.name,set:c.set.name,num:c.number,img:c.images.small,usd:bp?bp.usd:0,grade:p?.psa?(p.grade||'PSA'):'',t:Date.now()});
  localStorage.setItem('hist',JSON.stringify(h.slice(0,200)));renderHist()}
function renderHist(){const h=H();let tot=0;$('history').innerHTML=h.map((x,i)=>{tot+=x.usd||0;return `<div class="h" data-i="${i}"><img src="${x.img}" alt=""><div>${x.name}<div class="muted">${x.set} #${x.num} ${x.grade?'· '+x.grade:''}</div></div><div class="p">${money(x.usd)}<div class="muted">${thb(x.usd)}</div></div></div>`}).join('');
  $('total').textContent=h.length?`${h.length} cards · ${money(tot)} · ${thb(tot)}`:'';
  document.querySelectorAll('.h').forEach(el=>el.onclick=async()=>{const x=h[+el.dataset.i];const d=x.id.startsWith('tdx:')?[fromTdx(await tdxJSON('/cards/'+encodeURIComponent(x.id.slice(4))))]:await q(`id:${x.id}`,1);if(d[0])showResult(d[0],x.grade?{psa:true,grade:x.grade}:null,false)})}

/* ---------- Pipeline ---------- */
async function processCanvas(cv){
  const t0=performance.now();$('matches').innerHTML='';$('result').innerHTML='';status('Reading card…');
  const o=await ocrCanvas(cv);const p=parseText(o,$('mode').value);
  $('ocrText').textContent=`Parsed: ${JSON.stringify({number:p.number,total:p.total,psa:p.psa,grade:p.grade,cert:p.cert,words:p.words.slice(0,8)})}\n---\n${p.raw}`;
  status('Looking up prices…');
  let list=[];try{list=await findCards(p)}catch(e){status('Price lookup failed: '+e.message);return {p,list}}
  const ms=Math.round(performance.now()-t0);window.__ms=ms;
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
