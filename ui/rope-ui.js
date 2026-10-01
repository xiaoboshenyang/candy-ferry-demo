// Game-specific visual components. No physics, scoring, or public UI dependencies.
const ASSET_NAMES = ['candy', 'node', 'star', 'fox-goal', 'spike-strip'];
export const TOKENS = Object.freeze({
  background: '#fcf7eb', nodeDiameter: 26, candyDiameter: 36,
  starDiameter: 32, foxWidth: 140, ropeWidth: 5,
  rangeStroke: '#a6c4aa', rangeFill: 'rgba(160,190,160,0.035)',
});
export async function loadAssets(baseURL = new URL('./assets/', import.meta.url)) {
  const pairs = await Promise.all(ASSET_NAMES.map(async name => {
    const img = new Image();
    img.src = new URL(name + '.png', baseURL).href;
    await img.decode();
    return [name, img];
  }));
  return Object.fromEntries(pairs);
}
const point = (a, b, c, t) => ({
  x: (1-t)**2*a.x + 2*(1-t)*t*b.x + t*t*c.x,
  y: (1-t)**2*a.y + 2*(1-t)*t*b.y + t*t*c.y,
});
// Match visual sag to rope length, so a slack rope becomes straight when taut.
export function ropeCurve(from, to, length = Math.hypot(to.x-from.x, to.y-from.y)) {
  const direct = Math.hypot(to.x-from.x, to.y-from.y);
  const mid = { x: (from.x+to.x)/2, y: (from.y+to.y)/2 };
  if (length <= direct + 0.5) return [from, mid, to];
  let lo = 0, hi = Math.max(length * 2, 1);
  for (let pass = 0; pass < 18; pass++) {
    const sag = (lo+hi)/2, ctrl = { x: mid.x, y: mid.y+sag };
    let prev = from, total = 0;
    for (let i=1;i<=40;i++) {
      const p=point(from,ctrl,to,i/40);
      total+=Math.hypot(p.x-prev.x,p.y-prev.y); prev=p;
    }
    if (total < length) lo=sag; else hi=sag;
  }
  return [from, { x: mid.x, y: mid.y+(lo+hi)/2 }, to];
}
export class RopeUI {
  constructor(ctx, assets) { this.ctx=ctx; this.assets=assets; }
  sprite(name, x, y, width, { anchorX=.5, anchorY=.5, opacity=1 }={}) {
    const c=this.ctx, img=this.assets[name], height=width*img.height/img.width;
    c.save(); c.globalAlpha=opacity;
    c.drawImage(img,x-width*anchorX,y-height*anchorY,width,height); c.restore();
  }
  background(width, height) {
    const c=this.ctx;
    c.fillStyle=TOKENS.background; c.fillRect(0,0,width,height);
  }
  candy(x,y,diameter=TOKENS.candyDiameter) { this.sprite('candy',x,y,diameter); }
  star(x,y,diameter=TOKENS.starDiameter) { this.sprite('star',x,y,diameter); }
  // Position is bowl opening, NOT the center of the fox illustration.
  goal(x,y,width=TOKENS.foxWidth) { this.sprite('fox-goal',x,y,width,{anchorX:.74,anchorY:.575}); }
  node(x,y,{state='fixed',radius=0,diameter=TOKENS.nodeDiameter}={}) {
    if (!['fixed','ready','attached','spent'].includes(state)) throw new Error('Unknown node state');
    const c=this.ctx;
    if (state==='ready' && radius>0) {
      c.save(); c.beginPath(); c.arc(x,y,radius,0,Math.PI*2);
      c.fillStyle=TOKENS.rangeFill; c.fill();
      c.strokeStyle=TOKENS.rangeStroke; c.lineWidth=1.4; c.stroke(); c.restore();
    }
    this.sprite('node',x,y,diameter,{opacity:state==='spent'?.35:1});
    // A small physical slot plus fading distinguishes spent pins beyond color alone.
    if(state==='spent') {
      c.save(); c.strokeStyle='#6e756a'; c.lineWidth=1.5;
      c.beginPath(); c.moveTo(x-3,y+3); c.lineTo(x+3,y-3); c.stroke(); c.restore();
    }
  }
  rope(from,to,{length,width=TOKENS.ropeWidth}={}) {
    const c=this.ctx, [a,b,d]=ropeCurve(from,to,length);
    c.save(); c.lineCap='round'; c.lineJoin='round';
    c.beginPath(); c.moveTo(a.x,a.y); c.quadraticCurveTo(b.x,b.y,d.x,d.y);
    c.strokeStyle='#67391e'; c.lineWidth=width; c.stroke();
    c.strokeStyle='#ae7048'; c.lineWidth=width*.57; c.stroke();
    const n=Math.max(8,Math.ceil((length||Math.hypot(d.x-a.x,d.y-a.y))/3));
    let previous=a, travelled=0;
    for(let i=1;i<=n;i++) {
      const p=point(a,b,d,i/n), dx=p.x-previous.x,dy=p.y-previous.y;
      const step=Math.hypot(dx,dy); travelled+=step;
      if(travelled>=5 && step>.01) {
        travelled=0; const ux=dx/step,uy=dy/step, half=width*.28;
        c.beginPath();
        c.moveTo(p.x-uy*half-ux,p.y+ux*half-uy);
        c.lineTo(p.x+uy*half+ux,p.y-ux*half+uy);
        c.strokeStyle='#d6a47b'; c.lineWidth=.9; c.stroke();
      }
      previous=p;
    }
    c.restore();
  }
  // Repeat complete teeth rather than stretch a long bitmap across arbitrary lengths.
  spikes(x1,y1,x2,y2,{toothHeight=23}={}) {
    const c=this.ctx,img=this.assets['spike-strip'];
    const length=Math.hypot(x2-x1,y2-y1); if(length<1)return;
    const count=Math.max(1,Math.round(length/(toothHeight*.64)));
    const pitch=length/count;
    c.save(); c.translate(x1,y1); c.rotate(Math.atan2(y2-y1,x2-x1));
    for(let i=0;i<count;i++) {
      // Center tooth and its share of the continuous base in the six-tooth sprite.
      c.drawImage(img,146,0,67,img.height,i*pitch,-toothHeight*.5,pitch+.35,toothHeight);
    }
    c.restore();
  }
  renderWorld(world,{width=1280,height=728,worldWidth=1280,worldHeight=728,showBounds=false,stars=null}={}) {
    const c=this.ctx,scale=Math.min(width/worldWidth,height/worldHeight);
    c.clearRect(0,0,width,height);
    c.save(); c.translate((width-worldWidth*scale)/2,(height-worldHeight*scale)/2); c.scale(scale,scale);
    const visual=1/scale;
    for(const k of world.circles) {
      const r=world.ropes.find(r=>r.circle && r.id===k.id);
      const state=!k.used?'ready':r?.active?'attached':'spent';
      this.node(k.x,k.y,{state,radius:k.r,diameter:TOKENS.nodeDiameter*visual});
    }
    for(const r of world.ropes.filter(r=>!r.circle)) this.node(r.x,r.y,{diameter:TOKENS.nodeDiameter*visual});
    for(const r of world.ropes.filter(r=>r.active)) this.rope(r,world.candy,{length:r.len,width:TOKENS.ropeWidth*visual});
    // Redraw small pin heads over rope ends.
    for(const r of world.ropes.filter(r=>r.active)) this.sprite('node',r.x,r.y,TOKENS.nodeDiameter*visual);
    for(const s of world.spikes) this.spikes(...s,{toothHeight:23*visual});
    this.goal(world.goal[0],world.goal[1],TOKENS.foxWidth*visual);
    for(const s of (stars ?? world.stars ?? [])) if(!s.collected) this.star(s.x,s.y,TOKENS.starDiameter*visual);
    this.candy(world.candy.x,world.candy.y,TOKENS.candyDiameter*visual);
    if(showBounds) {
      c.save();c.strokeStyle='#8f518c';c.lineWidth=1; c.setLineDash([4,4]);
      c.beginPath();c.arc(world.candy.x,world.candy.y,world.candy.r,0,Math.PI*2);c.stroke();
      c.beginPath();c.ellipse(world.goal[0],world.goal[1],31,14,0,0,Math.PI*2);c.stroke();
      c.restore();
    }
    c.restore();
  }
}

