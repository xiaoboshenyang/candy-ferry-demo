import {createGameShell} from './public-template/template.js';
import {loadAssets,RopeUI,ropeCurve} from './ui/rope-ui.js';
import {LEVEL_NAMES,newSession,finishRound,resultSummary} from './rules.js';
import {QuestionPicker} from './question-picker.js';
import {createBackgroundAudio} from './audio.js';
import {hitRopes} from './cut-geometry.js';

const P=globalThis.RopePhysics,solver=globalThis.RopeSolver;
const $=id=>document.getElementById(id);
async function boot(){
if(!P||!solver)throw Error('固定物理或求解器未加载');
const [levels,solutions,assets]=await Promise.all([
 fetch('./data/levels.json?v=clearance-1').then(r=>{if(!r.ok)throw Error('levels.json 未加载');return r.json();}),
 fetch('./data/solutions.json?v=clearance-1').then(r=>{if(!r.ok)throw Error('solutions.json 未加载');return r.json();}),
 loadAssets()
]);
if(levels.length!==76)throw Error('题库尚未就绪：需要 19 母题 × 4 位置，共 76 题');
for(const l of levels){
 if(!l.id||!l.motherId||!Number.isInteger(l.level)||l.level<1||l.level>6||!Array.isArray(solutions[l.id]?.cuts))throw Error('题库结构或答案不完整：'+l.id);
}
const byId=new Map(levels.map(l=>[l.id,l]));
const picker=new QuestionPicker(levels),bgm=createBackgroundAudio('./assets/bgm-044.ogg');
const initialQid=new URLSearchParams(location.search).get('qid')||'';
if(initialQid&&!byId.has(initialQid))throw Error('未知题号：'+initialQid);
const config={mode:'playtest',title:'糖果摆渡',icon:'./assets/game-icon.png',clock:'external',feedbackDurationMs:1500,
 onState({state}){game.shellState=state;bgm.setState(state);}};
const game={api:null,shellState:'loading',session:null,round:null,canvas:null,ui:null,controls:null,question:null,
 settings:{mode:'auto',speed:100,hit:100,review:false,qid:initialQid},remainingMs:120000,lastFrame:0,physicsAccum:0,
 pointer:null,pointerId:null,calmSteps:0,analyzedAt:-1,playback:null,exhausted:false,
 noteUntil:0,noteText:'',idleMs:0,idleNoted:false,ended:false,timeoutPending:false,timeoutElapsed:0,timeoutPhysicsStart:0,actionInFlight:false};
function effectiveLevel(){return game.settings.mode==='auto'?game.session.level:Number(game.settings.mode);}
function outputSettings(){
 $('speed-value').textContent=game.settings.speed+'%';$('hit-value').textContent=game.settings.hit+'%';
 $('effective').textContent='当前：L'+(game.round?.level||effectiveLevel()||1)+' '+LEVEL_NAMES[(game.round?.level||effectiveLevel()||1)-1]
  +'｜速度 '+game.settings.speed+'%｜命中 '+game.settings.hit+'%';
}
function announce(text,ms=2500){game.noteText=text;game.noteUntil=performance.now()+ms;paintNote();}
function paintNote(){if(game.note)game.note.textContent=performance.now()<game.noteUntil?game.noteText:'';}
function setControlsDisabled(value){
 for(const b of game.controls.querySelectorAll('button'))b.disabled=value;
 const answerButton=game.controls.querySelector('#btn-answer');
 answerButton.textContent=game.playback?'停止回放':'看答案';
 if(game.playback&&!game.timeoutPending)answerButton.disabled=false;
}
function updateTop(){
 if(!game.api||!game.session)return;
 game.api.update({score:game.session.score,level:game.round?.level||effectiveLevel(),remainingMs:game.remainingMs});
 outputSettings();
}
function buildRound(level){
 cancelStroke();
 const selection=game.settings.qid?{question:byId.get(game.settings.qid),repeated:false}:picker.next(level);
 const data=selection.question,id=data.id;level=data.level;game.session.usedIds.add(id);
 game.round={id,level,data,world:P.createWorld(data),failures:0,hint:false,answerSeen:false,hintId:null,settledKind:null};
 game.physicsAccum=0;game.calmSteps=0;game.analyzedAt=-1;game.playback=null;game.idleMs=0;game.idleNoted=false;game.noteText='';game.noteUntil=0;game.actionInFlight=false;
 game.question.textContent=id+' · '+data.motherId;
 chooseControls(data);
 game.exhausted=false;game.finished.hidden=true;setControlsDisabled(false);
 updateTop();render();
 if(selection.repeated)announce('本级母题已全部出现，按最久未用的母题继续',3500);
 return true;
}
function chooseControls(l){
 const boxes=[[16,16],[907,16],[16,662],[907,662]];
 const score=([x,y])=>{
  const q={l:x,r:x+357,t:y<100?y:y-26,b:y<100?y+78:y+50},dist=(px,py)=>Math.hypot(Math.max(q.l-px,0,px-q.r),Math.max(q.t-py,0,py-q.b));
  let n=0;
  for(const r of l.ropes)n+=Math.max(0,40-dist(r[0],r[1]));
  for(const k of l.circles)n+=Math.max(0,k[2]+12-dist(k[0],k[1]));
  for(const [ax,ay,bx,by]of l.spikes)for(let i=0;i<=20;i++)n+=Math.max(0,20-dist(ax+(bx-ax)*i/20,ay+(by-ay)*i/20));
  n+=Math.max(0,40-dist(...l.candy))+Math.max(0,120-dist(...l.goal));
  return n;
 };
 boxes.sort((a,b)=>score(a)-score(b));
 game.controls.style.left=boxes[0][0]+'px';game.controls.style.top=boxes[0][1]+'px';
 game.question.style.left=boxes[0][0]+'px';game.question.style.right='auto';
 game.question.style.top=(boxes[0][1]<100?boxes[0][1]+54:boxes[0][1]-26)+'px';
}
function nextRound(){
 if(!game.session||game.ended)return;
 if(game.remainingMs<=0||game.timeoutPending){endSession();return;}
 if(game.settings.qid){announce('固定题已完成；在试玩面板选另一题，或点重新试玩');return;}
 buildRound(effectiveLevel());
}
function resetAttempt(){
 if(!game.round||game.ended)return;
 if(game.remainingMs<=0||game.timeoutPending){endSession();return;}
 cancelStroke();game.round.world=P.createWorld(game.round.data);game.round.hintId=null;
 game.physicsAccum=0;game.calmSteps=0;game.analyzedAt=-1;game.playback=null;game.idleMs=0;game.idleNoted=false;game.actionInFlight=false;
 setControlsDisabled(false);announce('这题再试一次',1800);render();
}
function finishedRound(kind){
 const round=game.round;if(!round||round.settledKind)return;
 round.settledKind=kind;setControlsDisabled(true);
 const stars=kind==='answer'||kind==='skip'?0:round.world.stars.filter(s=>s.collected).length;
 const result=finishRound(game.session,{kind,level:round.level,failures:round.failures,stars,id:round.id});
 const nextLevel=effectiveLevel();
 const up=result.direction==='up'&&game.settings.mode==='auto';
 const done=()=>nextRound();
 if(game.timeoutPending){updateTop();endSession();return;}
 if(kind==='skip'){
  // A skipped question is a settled mistake; the public failure badge is used as the result surface.
  game.api.feedback({correct:false,score:game.session.score,level:round.level,onComplete:done});
 }else{
  game.api.feedback({correct:true,score:game.session.score,scoreDelta:result.points,level:up?nextLevel:round.level,levelUp:up,onComplete:done});
 }
 updateTop();
}
function success(){
 const kind=game.round.answerSeen?'answer':game.round.hint?'hint':'independent';
 finishedRound(kind);
}
function fail(reason){
 const round=game.round;if(!round||round.settledKind)return;
 round.failures++;setControlsDisabled(true);game.physicsAccum=0;game.calmSteps=0;
 if(game.timeoutPending){endSession();return;}
 game.api.feedback({correct:false,score:game.session.score,level:round.level,onComplete:()=>resetAttempt()});
}
function stable(){
 const c=game.round.world.candy;
 return Math.hypot(c.vx,c.vy)<6&&game.calmSteps>=30&&P.activeRopes(game.round.world).length>0;
}
function checkDeadlock(){
 const w=game.round.world;
 if(game.pointer||!stable()||game.analyzedAt===w.steps)return;
 game.analyzedAt=w.steps;
 const result=solver.staticSolveWorld(w,8);
 if(result.complete&&!result.solvable)fail('deadlock');
}
function hint(){
 if(!game.round||game.round.settledKind||game.playback||game.timeoutPending||!game.api.isInteractive())return;
 if(!stable()){announce('等糖球停稳后再看提示');return;}
 const result=solver.staticSolveWorld(game.round.world,8);
 if(!result.complete||!result.path?.length){announce('当前状态暂时无法判断，可继续尝试');return;}
 game.round.hint=true;game.round.hintId=result.path[0].rope;
 announce('已标出下一根可剪的绳子',3500);render();
}
function answer(){
 if(game.playback&&!game.timeoutPending&&game.api.isInteractive()){game.playback=null;resetAttempt();announce('回放已停止，请自己试一遍');return;}
 if(!game.round||game.round.settledKind||game.playback||game.timeoutPending||!game.api.isInteractive())return;
 const sol=solutions[game.round.id];
 game.round.answerSeen=true;game.round.hintId=null;
 game.round.world=P.createWorld(game.round.data);game.playback={cuts:sol.cuts,index:0};
 game.physicsAccum=0;game.calmSteps=0;game.actionInFlight=false;setControlsDisabled(true);announce('看完后请自己再做一遍',4000);
}
function skip(){
 if(!game.round||game.round.settledKind||game.playback||game.timeoutPending||!game.api.isInteractive())return;
 finishedRound('skip');
}
function result(){return resultSummary(game.session);}
function localPoint(event){
 const box=game.canvas.getBoundingClientRect();
 return {x:(event.clientX-box.left)*1280/box.width,y:(event.clientY-box.top)*728/box.height};
}
function cancelStroke(){
 if(game.pointerId!==null&&game.canvas?.hasPointerCapture(game.pointerId))game.canvas.releasePointerCapture(game.pointerId);
 game.pointer=null;game.pointerId=null;
}
function pointerDown(e){
 if(!game.round||game.playback||game.timeoutPending||!game.api.isInteractive()||game.exhausted||game.round.settledKind)return;
 if(e.target!==game.canvas||e.button!==0||e.isPrimary===false||game.pointerId!==null)return;
 e.preventDefault();game.canvas.setPointerCapture(e.pointerId);
 game.pointer=localPoint(e);game.pointerId=e.pointerId;game.idleMs=0;game.idleNoted=false;paintNote();
}
function cutTo(e){
 if(!game.pointer||e.pointerId!==game.pointerId)return;
 const to=localPoint(e),from=game.pointer;game.pointer=to;
 if(!game.round||game.playback||game.timeoutPending||game.round.settledKind||!game.api.isInteractive())return;
 if(Math.hypot(to.x-from.x,to.y-from.y)<1e-6)return;
 const hits=hitRopes(from,to,game.round.world,4*game.settings.hit/100);
 let count=0;for(const id of hits)if(P.cut(game.round.world,id))count++;
 if(count){
  game.round.hintId=null;game.calmSteps=0;game.analyzedAt=-1;game.idleMs=0;game.idleNoted=false;game.actionInFlight=true;
  announce(count>1?'已剪断 '+count+' 根绳子':'绳子已剪断',800);render();
 }
}
function pointerMove(e){
 if(!game.pointer||e.pointerId!==game.pointerId)return;
 e.preventDefault();
 for(const sample of e.getCoalescedEvents?.()||[])cutTo(sample);
 cutTo(e);
}
function pointerUp(e){if(e.pointerId!==game.pointerId)return;cutTo(e);cancelStroke();}
function pointerCancel(e){if(e.pointerId===game.pointerId)cancelStroke();}
function render(){
 if(!game.round)return;
 const c=game.canvas.getContext('2d');
 c.clearRect(0,0,1280,728);
 game.ui.renderWorld(game.round.world);
 if(game.round.hintId){
  const r=P.activeRopes(game.round.world).find(r=>r.id===game.round.hintId);
  if(r){
   const [a,b,d]=ropeCurve(r,game.round.world.candy,r.len);
   c.save();c.strokeStyle='#edaa26';c.lineWidth=13;c.lineCap='round';c.globalAlpha=.8;
   c.beginPath();c.moveTo(a.x,a.y);c.quadraticCurveTo(b.x,b.y,d.x,d.y);c.stroke();c.restore();
   game.ui.rope(r,game.round.world.candy,{length:r.len});
  }
 }
 game.canvas.dataset.world=JSON.stringify({id:game.round.id,t:+game.round.world.t.toFixed(3),status:game.round.world.status,
  candy:[+game.round.world.candy.x.toFixed(1),+game.round.world.candy.y.toFixed(1)],
  ropes:P.activeRopes(game.round.world).map(r=>r.id),stars:game.round.world.stars.filter(s=>s.collected).length});
}
function endSession(){
 if(!game.session||game.ended)return;
 game.ended=true;game.timeoutPending=false;cancelStroke();game.playback=null;
 game.remainingMs=0;game.session.timeUnfinished+=game.round&&!game.round.settledKind?1:0;
 game.api.update({remainingMs:0,score:game.session.score,level:game.round?.level||effectiveLevel()});
 game.api.finish(result());
 const panel=document.querySelector('.playtest-panel section');
 if(panel){
  const summary=document.createElement('p');summary.className='session-summary';
  summary.textContent='本局 '+game.session.score+' 分 · 完成 '+game.session.correct+' 题 · 换题/看答案 '+game.session.errors+' 题 · 未完成 '+game.session.timeUnfinished+' 题';
  panel.querySelector('h2').after(summary);
 }
}
function frame(now){
 const elapsed=game.lastFrame?Math.max(0,(now-game.lastFrame)/1000):0;game.lastFrame=now;
 const running=game.session&&!game.ended&&game.shellState==='game';
 if(running){
  game.remainingMs=Math.max(0,game.remainingMs-elapsed*1000);
  game.api.update({remainingMs:game.remainingMs});
  if(game.remainingMs<=0&&!game.timeoutPending){
   if(game.shellState==='game'&&game.actionInFlight&&!game.playback&&!game.round?.settledKind){
    game.timeoutPending=true;game.timeoutElapsed=0;game.timeoutPhysicsStart=game.round.world.t;cancelStroke();setControlsDisabled(true);
    announce('时间到，等这次摆动结束',125000);
   }else endSession();
  }
 }
 if(running&&!game.ended&&game.round&&game.shellState==='game'&&!game.round.settledKind){
   if(game.timeoutPending)game.timeoutElapsed+=elapsed;
   game.physicsAccum+=Math.min(elapsed,.25)*game.settings.speed/100;
   let steps=0;
   while(game.physicsAccum>=P.STEP&&steps<600&&game.shellState==='game'&&game.round&&!game.round.settledKind&&!game.ended){
    if(game.playback){
     const pb=game.playback,w=game.round.world;
     while(pb.index<pb.cuts.length&&w.t>=pb.cuts[pb.index].t-1e-9){P.cut(w,pb.cuts[pb.index].rope);pb.index++;}
    }
    P.step(game.round.world);game.physicsAccum-=P.STEP;steps++;
    if(game.round.world.status!=='playing'){
     if(game.playback){game.playback=null;resetAttempt();announce('请自己再做一遍',2600);}
     else if(game.round.world.status==='won')success();
     else fail(game.round.world.reason);
     break;
    }
    if(!game.playback){
     const c=game.round.world.candy;
     game.calmSteps=Math.hypot(c.vx,c.vy)<6?game.calmSteps+1:0;
    }
   }
   if(game.round&&!game.playback&&!game.round.settledKind&&!game.ended){
    if(game.actionInFlight&&stable())game.actionInFlight=false;
    if(game.timeoutPending&&(!game.actionInFlight||game.round.world.t-game.timeoutPhysicsStart>=60)){endSession();}
    if(game.ended){render();requestAnimationFrame(frame);return;}
    if(steps&&game.calmSteps>=30&&game.analyzedAt<0)checkDeadlock();
    game.idleMs+=elapsed*1000;
    if(game.idleMs>=10000&&!game.idleNoted){game.idleNoted=true;announce('先看看糖果会往哪边摆',3500);}
   }
   if(steps)render();
 }
 paintNote();
 requestAnimationFrame(frame);
}
function mount({container,api}){
 game.api=api;container.innerHTML='';
 const canvas=document.createElement('canvas');canvas.className='rope-canvas';canvas.width=1280;canvas.height=728;canvas.setAttribute('aria-label','糖果摆渡操作区');container.append(canvas);
 game.canvas=canvas;game.ui=new RopeUI(canvas.getContext('2d'),assets);
 const controls=document.createElement('div');controls.className='game-controls';
 controls.innerHTML='<button type="button" id="btn-hint">提示</button><button type="button" id="btn-answer">看答案</button><button type="button" id="btn-skip">换题</button>';
 container.append(controls);game.controls=controls;
 controls.querySelector('#btn-hint').onclick=hint;controls.querySelector('#btn-answer').onclick=answer;controls.querySelector('#btn-skip').onclick=skip;
 const question=document.createElement('span');question.className='question-id';container.append(question);game.question=question;
 const note=document.createElement('div');note.className='game-note';note.setAttribute('role','status');container.append(note);game.note=note;
 const finished=document.createElement('div');finished.className='game-finished';finished.hidden=true;
 finished.innerHTML='<section><h2>题目已用完</h2><p>可以重新开始一局。</p><button type="button">重新开始</button></section>';
 finished.querySelector('button').onclick=()=>api.start(true);container.append(finished);game.finished=finished;
 canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);
 canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);
 canvas.addEventListener('lostpointercapture',pointerCancel);
}
function start(){
 game.session=newSession();picker.startSession();game.remainingMs=120000;game.exhausted=false;game.physicsAccum=0;game.lastFrame=0;
 game.ended=false;game.timeoutPending=false;game.timeoutElapsed=0;game.actionInFlight=false;bgm.reset();
 cancelStroke();game.round=null;
 buildRound(effectiveLevel());
 game.api.update({remainingMs:120000,score:0,level:game.round?.level||1});
}
function pause(){game.physicsAccum=0;cancelStroke();}
function resume(){game.lastFrame=0;}
const shell=createGameShell({mount:$('app'),config,mode:'playtest',adapter:{mount,start,pause,resume,getResult:result,destroy(){game.session=null;},onExit(){}}});
$('tool-toggle').onclick=()=>{const body=$('tool-body');body.hidden=!body.hidden;$('tool-toggle').setAttribute('aria-expanded',String(!body.hidden));};
$('level-mode').onchange=e=>{
 game.settings.mode=e.target.value;
 outputSettings();
};
$('speed').oninput=e=>{game.settings.speed=Number(e.target.value);outputSettings();};
$('hit').oninput=e=>{game.settings.hit=Number(e.target.value);outputSettings();};
$('review-mode').onchange=e=>{
 game.settings.review=e.target.checked;$('speed').max=game.settings.review?1600:150;
 if(!game.settings.review&&game.settings.speed>150){game.settings.speed=100;$('speed').value=100;}
 outputSettings();
};
$('mute').onchange=e=>bgm.setMuted(e.target.checked);
const qselect=$('question-select');
for(const l of [...levels].sort((a,b)=>a.level-b.level||a.id.localeCompare(b.id))){const option=document.createElement('option');option.value=l.id;option.textContent=l.id+' · L'+l.level+' · '+l.motherId;qselect.append(option);}
qselect.value=initialQid;
function selectQuestion(value){
 game.settings.qid=value;
 const url=new URL(location.href);if(value)url.searchParams.set('qid',value);else url.searchParams.delete('qid');history.replaceState(null,'',url);
 game.api.start(true);outputSettings();
}
qselect.onchange=e=>selectQuestion(e.target.value);
$('restart-question').onclick=()=>game.api.start(true);
$('restore').onclick=()=>{
 game.settings={mode:'auto',speed:100,hit:100,review:false,qid:''};
 $('level-mode').value='auto';$('speed').max=150;$('speed').value=100;$('hit').value=100;$('review-mode').checked=false;$('mute').checked=false;bgm.setMuted(false);qselect.value='';selectQuestion('');
};
outputSettings();requestAnimationFrame(frame);
globalThis.RopeDemoDebug={snapshot:()=>({
 shell:game.shellState,remainingMs:game.remainingMs,calmSteps:game.calmSteps,playing:game.shellState==='game'&&!game.ended&&!game.round?.settledKind,roundFinished:Boolean(game.round?.settledKind),
 timeout:{ended:game.ended,pending:game.timeoutPending,elapsed:game.timeoutElapsed,physicsElapsed:game.timeoutPending?game.round.world.t-game.timeoutPhysicsStart:0,actionInFlight:game.actionInFlight},bgm:bgm.snapshot(),
 settings:{...game.settings},round:game.round&&{id:game.round.id,level:game.round.level,failures:game.round.failures,hint:game.round.hint,hintId:game.round.hintId,answerSeen:game.round.answerSeen,
 world:structuredClone(P.clone(game.round.world))},session:game.session&&{...result(),level:game.session.level,independentStreak:game.session.independentStreak,helpStreak:game.session.helpStreak},
 exhausted:game.exhausted,history:game.session?.history.map(x=>({...x}))??[],picker:{usedMothers:[...picker.usedMothers],variantCursor:Object.fromEntries(picker.variantCursor)}
}),world:()=>game.round?structuredClone(P.clone(game.round.world)):null};
document.documentElement.dataset.ready='true';
}
boot().catch(error=>{
 console.error(error);document.documentElement.dataset.ready='error';
 $('app').replaceChildren();const panel=document.createElement('section');panel.className='load-error';
 const title=document.createElement('h1');title.textContent='糖果摆渡暂时无法加载';const message=document.createElement('p');message.textContent=error.message;
 const retry=document.createElement('button');retry.textContent='重新加载';retry.onclick=()=>location.reload();panel.append(title,message,retry);$('app').append(panel);
 $('playtest-tools').hidden=true;
});

