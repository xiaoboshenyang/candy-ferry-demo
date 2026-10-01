// Display only: the game owns both scoring and duplicate-settlement prevention.
export function buildFeedbackBadge({correct,scoreDelta,tutorial=false}={}) {
 const showScore=correct&&!tutorial&&Number.isFinite(scoreDelta)&&scoreDelta>0;
 if(showScore)return `<div class="badge score-badge"><div class="success-line"><span class="success-tick" aria-hidden="true">✓</span><span>完成了！</span></div><div class="score-award">+${scoreDelta}<small>分</small></div></div>`;
 return `<div class="badge"><div class="symbol ${correct?'':'bad'}" aria-hidden="true">${correct?'✓':'✕'}</div>${correct?'完成了！':'没关系，我们换一题'}</div>`;
}
