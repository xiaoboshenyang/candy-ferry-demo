// User-approved bowl-mouth reception. goal=[bowl center X,640], fox feet ~697/728.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BowlContact=api;})(globalThis,function(){
 const GOAL_Y=640, MOUTH_RX=30, MOUTH_RY=8, FOX_WIDTH=140;
 function hit(c,g,prev){
   if(!prev||c.y<=prev.y)return false;
   const plane=g[1]-(c.r||18)*0.5;
   if(prev.y>plane||c.y<plane)return false;
   const t=(plane-prev.y)/(c.y-prev.y),x=prev.x+(c.x-prev.x)*t;
   return Math.abs(x-g[0])<=MOUTH_RX;
 }
 return{hit,GOAL_Y,MOUTH_RX,MOUTH_RY,FOX_WIDTH,version:'bottom-bowl-v1'};
});

