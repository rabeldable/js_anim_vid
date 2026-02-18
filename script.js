/* Arc Thumbnail Demo — loads images from current directory (served by python -m http.server)
   Place index.html, styles.css, script.js in the same directory as PNGs and run: python3 -m http.server 8000
   Then open http://localhost:8000
  script.js — manifest-driven loader for Arc Thumbnails demo
  - Prefers ./manifest.json when present (ordered filenames array)
  - Falls back to parsing directory listing (python -m http.server style)
  - Loads images by fetching blobs, uses createImageBitmap with resize hint when possible
  - Falls back to Image() + ObjectURL where necessary, revokes ObjectURLs after decode
  - Exposes window.ArcThumb.startDemo() and setEndpoints(...) for console control
*/

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let DPR = Math.max(1, window.devicePixelRatio || 1);
function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * DPR);
  canvas.height = Math.round(rect.height * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resizeCanvas);

// Visual params
const FINAL_SIZE = 128;        // logical final thumbnail size (px)
const START_SCALE = 0.05;      // 5% start
const MILESTONE_STEPS = 20;    // discrete 5% steps
let smoothScale = false;

// Arc endpoints as percentages of canvas (0..1) — visible by default
let startPercent = { x: 0.08, y: 0.78 };
let endPercent   = { x: 0.92, y: 0.78 };
let arcHeightFactor = 0.35; // relative bow height

let items = []; // { img: Image|ImageBitmap|canvas, t, duration, delay }
let animationId = null;
let lastTs = 0;

function lerp(a,b,t){ return a + (b-a)*t; }

function computePosOnArc(t, w, h){
  const P0 = { x: startPercent.x * w, y: startPercent.y * h };
  const P1 = { x: endPercent.x   * w, y: endPercent.y   * h };
  const mid = { x: (P0.x + P1.x) * 0.5, y: (P0.y + P1.y) * 0.5 };
  const dx = P1.x - P0.x, dy = P1.y - P0.y;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist, perpY = dx / dist;
  const offset = arcHeightFactor * dist;
  const C = { x: mid.x + perpX * offset, y: mid.y + perpY * offset };
  const u = 1 - t;
  const x = u*u*P0.x + 2*u*t*C.x + t*t*P1.x;
  const y = u*u*P0.y + 2*u*t*C.y + t*t*P1.y;
  const dxdt = 2*u*(C.x - P0.x) + 2*t*(P1.x - C.x);
  const dydt = 2*u*(C.y - P0.y) + 2*t*(P1.y - C.y);
  const ang = Math.atan2(dydt, dxdt);
  return { x, y, ang };
}

function getScaleForProgress(progress){
  if(smoothScale){
    return START_SCALE + progress * (1 - START_SCALE);
  } else {
    let milestone = Math.floor(progress * MILESTONE_STEPS);
    const scale = Math.min(1.0, START_SCALE + milestone * (1.0 / MILESTONE_STEPS));
    return scale;
  }
}

// Normalize manifest entries and directory filenames to relative URLs usable by fetch('./...')
function normalizeEntryToUrl(entry){
  if(typeof entry !== 'string') return entry;
  entry = entry.trim();
  if(!entry) return entry;
  if(entry.match(/^https?:\/\//i) || entry.startsWith('data:')) return entry;
  if(entry.startsWith('./') || entry.startsWith('/')) return entry;
  return './' + entry;
}

// Try manifest.json first (ordered). Fallback to directory listing.
async function fetchImageList(){
  // Try manifest.json (no-cache to pick up edits)
  try{
    const r = await fetch('./manifest.json', { cache: 'no-store' });
    if(r.ok){
      const arr = await r.json();
      if(Array.isArray(arr) && arr.length){
        return arr.map(e => normalizeEntryToUrl(e)).filter(Boolean);
      }
    }
  }catch(e){
    // ignore and fall through to directory parsing
    console.info('manifest.json not used or unreadable:', e);
  }

  // Fallback: parse directory listing (works with python -m http.server)
  try{
    const resp = await fetch('./');
    const text = await resp.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const anchors = Array.from(doc.querySelectorAll('a'));
    const imgs = anchors.map(a => a.getAttribute('href'))
                        .filter(h => h && h.match(/\.(png|jpe?g)$/i));
    const uniq = [...new Set(imgs.map(s => decodeURIComponent(s).split('#')[0].split('?')[0]))];
    return uniq.map(e => normalizeEntryToUrl(e));
  }catch(e){
    console.error('Cannot fetch directory listing or manifest:', e);
    return [];
  }
}

// Load images robustly: fetch blob, prefer createImageBitmap with resize hint, fallback to Image
async function loadImagesFromList(list, limit){
  const out = [];
  const n = Math.min(limit || list.length, list.length);
  for(let i=0;i<n;i++){
    const url = list[i];
    try{
      const r = await fetch(url);
      if(!r.ok){ console.warn('fetch failed for', url, r.status); continue; }
      const blob = await r.blob();
      if(window.createImageBitmap){
        try{
          // Try to create a resized ImageBitmap to reduce memory
          const ib = await createImageBitmap(blob, { resizeWidth: FINAL_SIZE, resizeHeight: FINAL_SIZE, resizeQuality: 'high' });
          out.push(ib);
          continue;
        }catch(e){
          try{ const ib = await createImageBitmap(blob); out.push(ib); continue; }catch(e2){ /* fallback */ }
        }
      }
      // Fallback: Image element with object URL
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      URL.revokeObjectURL(objectUrl);
      out.push(img);
    }catch(err){
      console.warn('Failed to load image', url, err);
    }
  }
  return out;
}

function initItemsFromImages(imgs){
  cancelAnimationFrame(animationId);
  items = [];
  const travelDuration = 3000; // ms
  const stagger = 200; // ms
  const now = performance.now();
  for(let i=0;i<imgs.length;i++){
    items.push({ img: imgs[i], t: - (i*stagger)/travelDuration, duration: travelDuration, delay: i*stagger, startedAt: now + i*stagger });
  }
  lastTs = now;
  animationId = requestAnimationFrame(loop);
}

function update(dt){ for(const it of items){ it.t += dt / it.duration; if(it.t > 1.2) it.t = -0.2; } }

function draw(){
  const rect = canvas.getBoundingClientRect();
  const w = rect.width; const h = rect.height;
  ctx.clearRect(0,0,w,h);

  // guide curve
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.beginPath();
  const steps = 80; for(let i=0;i<=steps;i++){ const t=i/steps; const p=computePosOnArc(t,w,h); if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); } ctx.stroke(); ctx.restore();

  const sorted = items.slice().sort((a,b)=>a.t-b.t);
  for(const it of sorted){
    if(it.t < 0 || it.t > 1) continue;
    const t = Math.max(0, Math.min(1, it.t));
    const p = computePosOnArc(t, w, h);
    const progress = t;
    const scale = getScaleForProgress(progress);
    const size = FINAL_SIZE * scale;
    const x = p.x - size/2; const y = p.y - size/2;
    ctx.save(); ctx.globalAlpha = lerp(0.92, 1.0, progress); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 8*scale;
    try{ ctx.drawImage(it.img, x, y, size, size); }catch(e){ console.warn('drawImage failed for item', e); }
    ctx.restore();
  }
}

function loop(ts){ const dt = ts - lastTs; lastTs = ts; update(dt); draw(); animationId = requestAnimationFrame(loop); }

// UI bindings
const restartBtn = document.getElementById('restart');
if(restartBtn) restartBtn.addEventListener('click', async ()=>{ await startDemo(); });
const fitBtn = document.getElementById('fitEndpoints');
if(fitBtn) fitBtn.addEventListener('click', ()=>{ fitEndpoints(); });
const smoothCheckbox = document.getElementById('smooth');
if(smoothCheckbox) smoothCheckbox.addEventListener('change', (e)=>{ smoothScale = e.target.checked; });

canvas.addEventListener('click', function(ev){
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left; const cy = ev.clientY - rect.top;
  const px = cx / rect.width; const py = cy / rect.height;
  if(ev.shiftKey){ startPercent = { x: px, y: py }; if(window.ArcThumb && window.ArcThumb.startDemo) window.ArcThumb.startDemo(); }
  else if(ev.altKey || ev.ctrlKey){ endPercent = { x: px, y: py }; if(window.ArcThumb && window.ArcThumb.startDemo) window.ArcThumb.startDemo(); }
});

function fitEndpoints(){ startPercent = { x: 0.08, y: 0.78 }; endPercent = { x: 0.92, y: 0.78 }; arcHeightFactor = 0.35; if(window.ArcThumb && window.ArcThumb.startDemo) window.ArcThumb.startDemo(); }

async function startDemo(){
  resizeCanvas();
  const countInput = document.getElementById('count');
  const count = countInput ? parseInt(countInput.value || 12) : 12;
  smoothScale = document.getElementById('smooth') ? document.getElementById('smooth').checked : false;
  const list = await fetchImageList();
  if(list.length === 0){
    // fallback placeholders only if no images at all
    const placeholders = [];
    for(let i=0;i<count;i++){ const c = document.createElement('canvas'); c.width=c.height=FINAL_SIZE; const g=c.getContext('2d'); g.fillStyle = `hsl(${(i*37)%360} 70% 50%)`; g.fillRect(0,0,FINAL_SIZE,FINAL_SIZE); g.fillStyle='#fff'; g.font='36px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText(i+1,FINAL_SIZE/2,FINAL_SIZE/2); placeholders.push(c); }
    initItemsFromImages(placeholders);
    return;
  }
  const imgs = await loadImagesFromList(list, count);
  if(imgs.length === 0) console.warn('No images decoded from manifest/list — check DevTools Network and console for errors');
  initItemsFromImages(imgs.length ? imgs : []);
}

window.ArcThumb = {
  startDemo,
  setEndpoints: function(sx,sy,ex,ey,heightFactor){ startPercent = { x: sx, y: sy }; endPercent = { x: ex, y: ey }; if(typeof heightFactor === 'number') arcHeightFactor = heightFactor; if(window.ArcThumb.startDemo) window.ArcThumb.startDemo(); }
};

window.addEventListener('load', ()=>{ resizeCanvas(); startDemo(); });

