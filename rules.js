export const LEVEL_NAMES=['基础','初阶','中阶','高阶','超凡','宗师'];
export const FULL_POINTS=[0,20,24,28,32,36,40];
export const UPGRADE_NEED=[0,1,1,2,2,2,Infinity];
export function newSession(){
 return {score:0,level:1,maxLevel:1,correct:0,errors:0,timeUnfinished:0,
  independentStreak:0,helpStreak:0,usedIds:new Set(),
  levels:Array.from({length:6},(_,i)=>({level:i+1,label:LEVEL_NAMES[i],score:0,clears:0,errors:0})),
  history:[]};
}
export function finishRound(session,{kind,level,failures=0,stars=0,id}){
 if(!['independent','hint','answer','skip'].includes(kind))throw Error('Unknown result '+kind);
 const stat=session.levels[level-1],full=FULL_POINTS[level];
 const points=kind==='independent'?full+stars*5:kind==='hint'?full/2+stars*5:0;
 session.score+=points;stat.score+=points;
 if(kind==='independent'||kind==='hint'){session.correct++;stat.clears++;}
 else{session.errors++;stat.errors++;}
 const priorLevel=session.level;
 let direction='same';
 if(failures>=2){session.level=Math.max(1,level-1);session.independentStreak=0;session.helpStreak=0;direction=session.level<level?'down':'same';}
 else if(kind==='independent'){
  session.independentStreak++;session.helpStreak=0;
  if(session.independentStreak>=UPGRADE_NEED[level]){session.level=Math.min(6,level+1);session.independentStreak=0;session.helpStreak=0;direction=session.level>level?'up':'same';}
 }else{
  session.helpStreak++;session.independentStreak=0;
  if(session.helpStreak>=2){session.level=Math.max(1,level-1);session.independentStreak=0;session.helpStreak=0;direction=session.level<level?'down':'same';}
 }
 session.maxLevel=Math.max(session.maxLevel,session.level,level);
 const row={id,level,kind,failures,stars:kind==='answer'||kind==='skip'?0:stars,points,direction,nextLevel:session.level};
 session.history.push(row);
 return row;
}
export function resultSummary(session){
 return {totalScore:session.score,levels:session.levels.map(x=>({...x})),correct:session.correct,errors:session.errors,
  maxLevel:session.maxLevel,timeUnfinished:session.timeUnfinished,history:session.history.map(x=>({...x}))};
}

