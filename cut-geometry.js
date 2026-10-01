import {ropeCurve} from './ui/rope-ui.js';

function pointDistance(p,a,b){
 const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
export function segmentDistance(a,b,c,d){
 // Crossing segments can have all four endpoints far apart.
 const overlaps=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+1e-9
  &&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+1e-9;
 if(overlaps&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return 0;
 return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
export function ropeDistance(from,to,rope,candy){
 const [a,b,c]=ropeCurve(rope,candy,rope.len),n=Math.max(12,Math.ceil(rope.len/8));
 let prev=a,best=Infinity;
 for(let i=1;i<=n;i++){
  const t=i/n,p={x:(1-t)**2*a.x+2*(1-t)*t*b.x+t*t*c.x,y:(1-t)**2*a.y+2*(1-t)*t*b.y+t*t*c.y};
  best=Math.min(best,segmentDistance(from,to,prev,p));prev=p;
 }
 return best;
}
export function hitRopes(from,to,world,width){
 return world.ropes.filter(r=>r.active&&ropeDistance(from,to,r,world.candy)<=width).map(r=>r.id);
}
