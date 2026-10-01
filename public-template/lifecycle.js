// Pure elapsed-time state. Wall-clock deltas, not one-second counters.
export class Lifecycle {
  constructor(){this.reset();}
  reset(){this.state='intro';this.remainingMs=120000;this.pending=null;this.pausedFrom=null;}
  get running(){return ['game','feedback','levelup'].includes(this.state);}
  pause(){if(!this.running&&this.state!=='tutorial')return false;this.pausedFrom=this.state;this.state='paused';return true;}
  resume(){if(this.state!=='paused')return false;this.state=this.pausedFrom;this.pausedFrom=null;return true;}
  wait(state,ms,callback){this.state=state;this.pending={remainingMs:ms,callback};}
  finish(){this.state='timeup';this.pending=null;}
  advance(ms,external=false){
    if(!this.running&&this.state!=='tutorial')return;
    if(!external&&this.state!=='tutorial'){this.remainingMs=Math.max(0,this.remainingMs-ms);if(this.remainingMs===0){this.finish();return 'expired';}}
    if(this.pending){this.pending.remainingMs-=ms;if(this.pending.remainingMs<=0){const fn=this.pending.callback;this.pending=null;fn?.();}}
  }
}
