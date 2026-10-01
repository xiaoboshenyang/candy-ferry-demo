/**
 * 游戏结果页公共组件（report-card 布局）
 *
 * 从 game-session-ui.js 中提取的独立 report-card 结果页组件，
 * 品牌卡区域（icon、游戏名、tags）全部参数化配置。
 *
 * 用法：
 *   import { createResultPage } from '../shared/result-page/game-result-page.js';
 *
 *   const resultPage = createResultPage({
 *       mountNode: document.getElementById('result-mount'),
 *       gameTitle: '家常乐消消',
 *       abilityLabel: '加工速度',
 *       brandTags: ['选择性注意', '视觉知觉'],
 *       iconHtml: '<div>🏠</div>',
 *       headerTitle: '训练完成',
 *       continueText: '继续训练',
 *       onContinue: () => startCountdown(),
 *       onBack: () => exitToGameList(),
 *   });
 *
 *   resultPage.showResult({ levels: [...], totalScore: 385 });
 */

import { ensureGameAudioMaster, getGameAudioContext } from '../audio/game-audio-context.js';
import { volumeToPerceivedGain } from '../audio/game-audio-prefs.js';
import { GameAudioSettings } from '../audio/game-audio-settings.js';
import { exitToGameList } from '../session-ui/game-session-ui.js';
import { hideTimeUp } from '../time-up/game-time-up.js';

// =================== 常量 ===================

const LEVEL_ORDER = [1, 2, 3, 4, 5, 6];

const LEVEL_LABELS = { 1: '基础', 2: '初阶', 3: '中阶', 4: '高阶', 5: '超凡', 6: '宗师' };

const GOOD_METRIC_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" class="sm-session-result-metric-icon-svg sm-session-result-metric-icon-svg--good" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11.25" fill="#2DD462"/>
    <path d="M7.35 12.45L10.2 15.3L16.65 8.85" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const BAD_METRIC_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" class="sm-session-result-metric-icon-svg sm-session-result-metric-icon-svg--bad" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11.25" fill="#FF4D55"/>
    <path d="M9.15 9.15L14.85 14.85M14.85 9.15L9.15 14.85" stroke="#FFFFFF" stroke-width="2.7" stroke-linecap="round"/>
</svg>`;

const SCORE_REVEAL_TICK_NOTES = [523.25, 659.25, 783.99, 987.77];

const SCORE_REVEAL_CONFIG = {
    baseRollDurationMs: 860,
    perDigitDurationMs: 150,
    buttonRevealDelayMs: 320,
    finishCleanupDelayMs: 320,
    rollTickIntervalMs: 88,
    rowIntroDelayMs: 40,
    rowIntroStepMs: 58,
};

// =================== 音频系统 ===================

let _noiseBuffer = null;

// 结果页合成音走小游戏唯一 AudioContext 与主总线，并受「音效」开关 / 音量约束。
function _withAudio(fn) {
    if (!GameAudioSettings.isEnabled('sfx')) return;
    let ctx = null;
    try {
        ctx = getGameAudioContext({ resume: true });
    } catch (error) {
        console.warn('[ResultPage] 获取 AudioContext 失败:', error);
        return;
    }
    if (!ctx || ctx.state !== 'running') return;
    try {
        fn(ctx);
    } catch (error) {
        console.warn('[ResultPage] 音效播放失败:', error);
    }
}

function _sfxUserGain() {
    return volumeToPerceivedGain(GameAudioSettings.getVolume('sfx'));
}

function _connectAudioNode(ctx, src, gain, { pan = 0, filterType = null, filterFrequency = 1200, filterQ = 0.8 } = {}) {
    let tail = src;
    if (filterType) {
        const f = ctx.createBiquadFilter();
        f.type = filterType; f.frequency.value = filterFrequency; f.Q.value = filterQ;
        src.connect(f); tail = f;
    }
    if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        tail.connect(p); p.connect(gain);
    } else { tail.connect(gain); }
    gain.connect(ensureGameAudioMaster(ctx) || ctx.destination);
}

function _getNoiseBuffer(ctx) {
    if (_noiseBuffer) return _noiseBuffer;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.45), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    _noiseBuffer = buf;
    return buf;
}

function _scheduleTone(ctx, { startFreq, endFreq, duration = 0.16, type = 'triangle', volume = 0.08, attack = 0.01, pan = 0, startAt, filterType, filterFrequency = 1200, filterQ = 0.8 }) {
    const t = startAt ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, startFreq), t);
    if (endFreq && Math.abs(endFreq - startFreq) > 1) osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + duration);
    _connectAudioNode(ctx, osc, gain, { pan, filterType, filterFrequency, filterQ });
    const peak = t + Math.min(Math.max(attack, 0.01), duration * 0.35);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * _sfxUserGain()), peak);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t); osc.stop(t + duration + 0.03);
}

function _playTone({ startDelay = 0, ...opts }) {
    _withAudio((ctx) => _scheduleTone(ctx, { ...opts, startAt: ctx.currentTime + startDelay }));
}

function _playNoiseBurst({ duration = 0.12, volume = 0.06, pan = 0, startDelay = 0, filterType = 'bandpass', filterFrequency = 1000, filterQ = 0.9 }) {
    _withAudio((ctx) => {
        const t = ctx.currentTime + startDelay;
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = _getNoiseBuffer(ctx);
        _connectAudioNode(ctx, src, gain, { pan, filterType, filterFrequency, filterQ });
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * _sfxUserGain()), t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.start(t); src.stop(t + duration + 0.03);
    });
}

function _playTickSound(step = 0) {
    const note = SCORE_REVEAL_TICK_NOTES[step % SCORE_REVEAL_TICK_NOTES.length];
    const pan = step % 2 === 0 ? -0.08 : 0.08;
    _playTone({ startFreq: note, endFreq: note * 1.03, duration: 0.082, type: 'triangle', volume: 0.038, pan, filterType: 'lowpass', filterFrequency: 2100, filterQ: 0.16 });
    _playTone({ startFreq: note * 0.5, endFreq: note * 0.505, duration: 0.095, type: 'sine', volume: 0.016, pan: -pan * 0.5, startDelay: 0.012, filterType: 'lowpass', filterFrequency: 940, filterQ: 0.12 });
    if (step % 3 === 2) _playNoiseBurst({ duration: 0.038, volume: 0.006, filterType: 'highpass', filterFrequency: 2800, filterQ: 0.92, startDelay: 0.012 });
}

function _playFinishSound(score = 0) {
    const boost = Math.min(0.02, String(Math.max(0, Number(score) || 0)).length * 0.004);
    _playTone({ startFreq: 659.25, endFreq: 880, duration: 0.16, type: 'triangle', volume: 0.084 + boost, pan: -0.1, filterType: 'lowpass', filterFrequency: 2500, filterQ: 0.16 });
    _playTone({ startFreq: 783.99, endFreq: 1174.66, duration: 0.18, type: 'sine', volume: 0.096 + boost, pan: 0.12, startDelay: 0.05, filterType: 'lowpass', filterFrequency: 2400, filterQ: 0.14 });
    _playTone({ startFreq: 987.77, endFreq: 1567.98, duration: 0.22, type: 'triangle', volume: 0.088 + boost, pan: 0.03, startDelay: 0.11, filterType: 'lowpass', filterFrequency: 2900, filterQ: 0.14 });
    _playTone({ startFreq: 392, endFreq: 523.25, duration: 0.22, type: 'sine', volume: 0.03, pan: -0.04, startDelay: 0.03, filterType: 'lowpass', filterFrequency: 1240, filterQ: 0.1 });
    _playNoiseBurst({ duration: 0.08, volume: 0.02, filterType: 'highpass', filterFrequency: 2600, filterQ: 0.86, startDelay: 0.02 });
    _playNoiseBurst({ duration: 0.1, volume: 0.015, filterType: 'bandpass', filterFrequency: 1450, filterQ: 1.08, pan: 0.08, startDelay: 0.12 });
}

// =================== 工具函数 ===================

function _escHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _toCssUrl(value) {
    if (!value) return 'none';
    return `url("${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

function _toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function _buildElement(markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    return tpl.content.firstElementChild;
}

function _getRevealConfig() {
    const params = new URLSearchParams(window.location.search || '');
    const scale = Math.min(20, Math.max(0.2, Number(params.get('resultRollScale')) || 1));
    return {
        ...SCORE_REVEAL_CONFIG,
        baseRollDurationMs: Math.round(SCORE_REVEAL_CONFIG.baseRollDurationMs * scale),
        perDigitDurationMs: Math.round(SCORE_REVEAL_CONFIG.perDigitDurationMs * scale),
        buttonRevealDelayMs: Math.round(SCORE_REVEAL_CONFIG.buttonRevealDelayMs * scale),
        finishCleanupDelayMs: Math.round(SCORE_REVEAL_CONFIG.finishCleanupDelayMs * scale),
        rollTickIntervalMs: Math.max(60, Math.round(SCORE_REVEAL_CONFIG.rollTickIntervalMs * Math.max(0.7, scale * 0.55))),
    };
}

function _isDailyRecommendGame() {
    return new URLSearchParams(window.location.search || '').get('dailyRecommend') === '1';
}

function _isLastDailyRecommendGame() {
    return new URLSearchParams(window.location.search || '').get('dailyRecommendIsLast') === 'true';
}

// =================== HTML 构建 ===================

function _buildIconMarkup({ gameTitle, iconAlt, iconSrc, iconHtml }) {
    if (iconHtml) return iconHtml;
    const src = iconSrc ? ` src="${_escHtml(iconSrc)}"` : '';
    return `<img class="sm-session-result-icon-img"${src} alt="${_escHtml(iconAlt || gameTitle)}">`;
}

function _normalizeTags(brandTags, abilityLabel = '') {
    if (Array.isArray(brandTags) && brandTags.length > 0) return brandTags.filter((t) => String(t || '').trim());
    return abilityLabel ? [abilityLabel] : [];
}

function _buildTagsHtml(brandTags, abilityLabel = '') {
    return _normalizeTags(brandTags, abilityLabel)
        .map((tag) => `<span class="sm-session-result-tag">${_escHtml(tag)}</span>`)
        .join('');
}

function _buildRowsHtml(levels = [], { badMetricLabel = '失误' } = {}) {
    return levels.map((lv) => {
        const level = Number(lv?.level) || 0;
        const label = lv?.label || LEVEL_LABELS[level] ;
        const score = _toNumber(lv?.score);
        const clears = _toNumber(lv?.clears);
        const errors = _toNumber(lv?.errors);
        return `
        <div id="level-${level}-stats" data-testid="level-${level}-stats" data-level="${level}"
             class="sm-session-result-row sm-session-result-row--level-${level}"
             style="--result-fill-width:100%"
             aria-label="${_escHtml(label)}: 得分 ${score}，消除 ${clears} 次，${_escHtml(badMetricLabel)} ${errors} 次">
            <div class="sm-session-result-row-label">${_escHtml(label)}</div>
            <div class="sm-session-result-row-bar">
                <span class="sm-session-result-row-track">
                    <span class="sm-session-result-row-fill"></span>
                    <span class="sm-session-result-row-score">${score}</span>
                </span>
            </div>
            <div class="sm-session-result-row-metrics">
                <span class="sm-session-result-metric sm-session-result-metric--good">
                    <span class="sm-session-result-metric-icon" aria-hidden="true">${GOOD_METRIC_ICON_SVG}</span>
                    <span class="sm-session-result-metric-value">${clears}</span>
                </span>
                <span class="sm-session-result-metric sm-session-result-metric--bad">
                    <span class="sm-session-result-metric-icon" aria-hidden="true">${BAD_METRIC_ICON_SVG}</span>
                    <span class="sm-session-result-metric-value">${errors}</span>
                </span>
            </div>
        </div>
    `;
    }).join('');
}

function _buildResultPageHtml({
    headerTitle, gameTitle, abilityLabel, iconAlt, iconSrc, iconHtml,
    backgroundImageSrc, brandTags, continueText, continueTestId, isDailyRecommend,
}) {
    return `
        <section id="complete-page" class="sm-session-result-screen sm-session-result-screen--report-card hidden"
                 data-testid="result-page" data-result-variant="report-card">
            <div class="sm-session-result-bg" aria-hidden="true" data-session-role="result-bg">
                <img class="sm-session-result-bg-img" src="${_escHtml(backgroundImageSrc || '')}" alt="" />
                <div class="sm-session-result-bg-overlay"></div>
            </div>
            <div class="sm-session-result-shell sm-session-result-shell--report-card">
                <div class="sm-session-result-header sm-session-result-header--report-card">
                    <button type="button" class="sm-back-btn sm-session-result-back${isDailyRecommend ? ' sm-session-result-back--daily' : ''}"
                            data-testid="result-back-btn" data-session-action="back" aria-label="${isDailyRecommend ? '返回今日训练' : '返回游戏列表'}">
                        <span class="sm-back-btn__icon" aria-hidden="true"></span>
                        ${isDailyRecommend ? '<span class="sm-session-result-back-label">返回今日训练</span>' : ''}
                    </button>
                    <div class="sm-session-result-heading" data-session-role="header-title">${_escHtml(headerTitle || '训练完成')}</div>
                </div>
                <div class="sm-session-result-layout sm-session-result-layout--report-card">
                    <div class="sm-session-result-board">
                        <div class="sm-session-result-board-card sm-session-result-board-card--report-card" id="result-stats"></div>
                    </div>
                    <div class="sm-session-result-side sm-session-result-side--report-card">
                        <div class="sm-session-result-brand-card">
                            <div class="sm-session-result-brand">
                                <div class="sm-session-result-icon" data-session-role="icon">
                                    ${_buildIconMarkup({ gameTitle, iconAlt, iconSrc, iconHtml })}
                                </div>
                                <div class="sm-session-result-copy">
                                    <h1 class="sm-session-result-title" data-session-role="game-title">${_escHtml(gameTitle)}</h1>
                                    <div class="sm-session-result-tags" data-session-role="brand-tags">
                                        ${_buildTagsHtml(brandTags, abilityLabel)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <section class="sm-session-result-score-card sm-session-result-score-card--report-card">
                            <div class="sm-session-result-score-caption">训练完成</div>
                            <div class="sm-session-result-score-label">得分:</div>
                            <div id="summary-score" class="sm-session-result-score-value" data-session-role="total-score">0</div>
                        </section>
                        <button type="button"
                                class="sm-session-result-continue sm-session-result-continue--report-card"
                                data-testid="${_escHtml(continueTestId)}"
                                data-session-action="continue">
                            ${_escHtml(continueText)}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

// =================== 分数滚轮 ===================

function _buildDigitSequence(startDigit, finalDigit, turns = 3) {
    const s = Math.max(0, Math.min(9, Math.round(Number(startDigit) || 0)));
    const f = Math.max(0, Math.min(9, Math.round(Number(finalDigit) || 0)));
    const dist = (f - s + 10) % 10;
    const steps = Math.max(1, turns) * 10 + dist;
    return Array.from({ length: steps + 1 }, (_, i) => (s + i) % 10);
}

function _measureDigitWidths(scoreNode, text = '') {
    if (!scoreNode || !text) return [];
    const style = getComputedStyle(scoreNode);
    const root = document.createElement('span');
    Object.assign(root.style, {
        position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden',
        pointerEvents: 'none', whiteSpace: 'nowrap',
        fontSize: style.fontSize, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        fontFamily: style.fontFamily, fontVariantNumeric: style.fontVariantNumeric,
        fontFeatureSettings: style.fontFeatureSettings, fontKerning: style.fontKerning,
    });
    String(text).split('').forEach((d) => {
        const el = document.createElement('span');
        el.textContent = d; el.style.display = 'inline-block';
        root.appendChild(el);
    });
    document.body.appendChild(root);
    const widths = [...root.children].map((el) => el.getBoundingClientRect().width);
    const measured = widths.reduce((s, w) => s + w, 0);
    const target = scoreNode.offsetWidth;
    root.remove();
    if (target > 0 && measured > 0) {
        const scale = target / measured;
        return widths.map((w) => Math.max(1, w * scale));
    }
    return widths;
}

function _buildReelsMarkup(totalScore = 0, digitWidths = []) {
    const digits = String(Math.max(0, Number(totalScore) || 0)).split('');
    return digits.map((digit, i) => {
        const final = Math.max(0, Math.min(9, Number(digit) || 0));
        const start = (final + digits.length + i * 2 + 1) % 10;
        const turns = Math.min(4, Math.max(2, digits.length - 1 + Math.floor(i / 2)));
        const seq = _buildDigitSequence(start, final, turns);
        const html = seq.map((v) => `<span class="sm-session-result-reel-digit">${v}</span>`).join('');
        const w = Number(digitWidths[i]);
        const ws = Number.isFinite(w) && w > 0 ? ` style="flex-basis:${w.toFixed(3)}px;width:${w.toFixed(3)}px"` : '';
        return `<span class="sm-session-result-reel" data-digit-index="${i}"${ws}><span class="sm-session-result-reel-track">${html}</span></span>`;
    }).join('');
}

// =================== 分数揭示控制器 ===================

function _createScoreRevealController(root) {
    const st = {
        runId: 0, timeoutIds: new Set(), rafIds: new Set(),
        audioIntervalId: null, resizeObserver: null, observedScoreNode: null,
        scoreCard: null, scoreStack: null, scoreNode: null,
        scoreStage: null, scoreReels: null, continueButton: null, rowNodes: [],
    };

    function clearTasks() {
        st.timeoutIds.forEach((id) => clearTimeout(id)); st.timeoutIds.clear();
        st.rafIds.forEach((id) => cancelAnimationFrame(id)); st.rafIds.clear();
        if (st.audioIntervalId) { clearInterval(st.audioIntervalId); st.audioIntervalId = null; }
    }

    function schedTimeout(fn, ms, rid = st.runId) {
        const id = setTimeout(() => { st.timeoutIds.delete(id); if (rid !== st.runId) return; fn(); }, ms);
        st.timeoutIds.add(id); return id;
    }

    function schedRaf(fn, rid = st.runId) {
        const id = requestAnimationFrame(() => { st.rafIds.delete(id); if (rid !== st.runId) return; fn(); });
        st.rafIds.add(id); return id;
    }

    function ensureUi() {
        const page = root.querySelector('[data-testid="result-page"][data-result-variant="report-card"]');
        const scoreCard = page?.querySelector('.sm-session-result-score-card--report-card');
        const scoreNode = page?.querySelector('[data-session-role="total-score"]');
        const btn = page?.querySelector('.sm-session-result-continue--report-card');
        if (!page || !scoreCard || !scoreNode) return null;

        let scoreStack = scoreCard.querySelector('.sm-session-result-score-stack');
        if (!scoreStack) {
            scoreStack = document.createElement('div');
            scoreStack.className = 'sm-session-result-score-stack';
            scoreNode.parentNode?.insertBefore(scoreStack, scoreNode);
            scoreStack.appendChild(scoreNode);
        }

        let scoreStage = scoreCard.querySelector('.sm-session-result-score-stage');
        if (!scoreStage) {
            scoreStage = document.createElement('div');
            scoreStage.className = 'sm-session-result-score-stage';
            scoreStage.setAttribute('aria-hidden', 'true');
            scoreStage.innerHTML = `
                <span class="sm-session-result-score-stage-glow"></span>
                <span class="sm-session-result-score-stage-flash"></span>
                <span class="sm-session-result-score-reels"></span>
            `;
            scoreStack.appendChild(scoreStage);
        } else if (scoreStage.parentElement !== scoreStack) {
            scoreStack.appendChild(scoreStage);
        }

        scoreCard.classList.add('sm-session-result-score-card--animated');
        scoreNode.classList.add('sm-session-result-score-source');
        btn?.classList.add('sm-session-result-continue--animated');

        st.scoreCard = scoreCard; st.scoreStack = scoreStack; st.scoreNode = scoreNode;
        st.scoreStage = scoreStage;
        st.scoreReels = scoreStage.querySelector('.sm-session-result-score-reels');
        st.continueButton = btn;
        st.rowNodes = [...page.querySelectorAll('.sm-session-result-row')];

        if (typeof ResizeObserver === 'function') {
            if (!st.resizeObserver) {
                st.resizeObserver = new ResizeObserver(() => schedRaf(() => syncStack()));
            }
            if (st.observedScoreNode !== scoreNode) {
                st.resizeObserver.disconnect();
                st.resizeObserver.observe(scoreNode);
                st.observedScoreNode = scoreNode;
            }
        }
        return st;
    }

    function syncReelOffsets() {
        const ui = ensureUi();
        if (!ui?.scoreReels || !ui.scoreStage?.classList.contains('is-visible') || !ui.scoreStage.classList.contains('is-finished')) return;
        ui.scoreReels.querySelectorAll('.sm-session-result-reel').forEach((reel) => {
            const track = reel.querySelector('.sm-session-result-reel-track');
            if (!track) return;
            const h = parseFloat(getComputedStyle(reel).height) || parseFloat(getComputedStyle(reel).fontSize) || 10;
            const off = Math.max(0, track.children.length - 1) * h;
            const prev = track.style.transition;
            track.style.transition = 'none'; track.style.transform = `translateY(${-off}px)`;
            void track.offsetHeight; track.style.transition = prev;
        });
    }

    function syncTypography(ui) {
        if (!ui?.scoreStack || !ui.scoreNode) return;
        const s = getComputedStyle(ui.scoreNode);
        const ss = ui.scoreStack.style;
        ss.fontSize = s.fontSize; ss.fontWeight = s.fontWeight; ss.lineHeight = s.lineHeight;
        ss.letterSpacing = s.letterSpacing; ss.fontFamily = s.fontFamily; ss.color = s.color;
        ss.fontVariantNumeric = s.fontVariantNumeric; ss.fontFeatureSettings = s.fontFeatureSettings;
        ss.fontKerning = s.fontKerning;
    }

    function syncStack() {
        const ui = ensureUi();
        if (!ui?.scoreStack || !ui.scoreNode) return;
        syncTypography(ui);
        const r = {width:ui.scoreNode.offsetWidth,height:ui.scoreNode.offsetHeight};
        if (r.width <= 0 || r.height <= 0) return;
        ui.scoreStack.style.minWidth = `${Math.ceil(r.width)}px`;
        ui.scoreStack.style.height = `${r.height}px`;
        syncReelOffsets();
    }

    function reset() {
        clearTasks(); st.runId += 1;
        const ui = ensureUi();
        if (!ui) return;
        const page = root.querySelector('[data-testid="result-page"][data-result-variant="report-card"]');
        page?.classList.remove('sm-session-result-page--playing', 'sm-session-result-page--celebrate');
        ui.scoreCard.dataset.revealState = 'idle';
        ui.scoreNode.classList.remove('sm-session-result-score-source--hidden');
        ui.scoreStage.classList.remove('is-visible', 'is-finished');
        ui.continueButton?.classList.remove('sm-session-result-continue--hidden', 'sm-session-result-continue--ready');
        ui.rowNodes.forEach((row) => { row.classList.remove('sm-session-result-row--intro'); row.style.removeProperty('--sm-session-result-row-delay'); });
        if (ui.scoreStack) { ui.scoreStack.style.removeProperty('min-width'); ui.scoreStack.style.removeProperty('height'); }
        if (ui.scoreReels) ui.scoreReels.innerHTML = '';
    }

    function startTickLoop(rid = st.runId) {
        const cfg = _getRevealConfig();
        if (st.audioIntervalId) clearInterval(st.audioIntervalId);
        let tick = 0;
        _playTickSound(tick++);
        st.audioIntervalId = setInterval(() => {
            if (rid !== st.runId) { clearInterval(st.audioIntervalId); st.audioIntervalId = null; return; }
            _playTickSound(tick++);
        }, cfg.rollTickIntervalMs);
    }

    function finish(score, rid = st.runId) {
        const cfg = _getRevealConfig();
        if (rid !== st.runId) return;
        if (st.audioIntervalId) { clearInterval(st.audioIntervalId); st.audioIntervalId = null; }
        const ui = ensureUi();
        if (!ui) return;
        const page = root.querySelector('[data-testid="result-page"][data-result-variant="report-card"]');
        ui.scoreCard.dataset.revealState = 'celebrate';
        ui.scoreStage.classList.add('is-finished');
        page?.classList.add('sm-session-result-page--celebrate');
        syncReelOffsets();
        _playFinishSound(score);
        schedTimeout(() => {
            ui.continueButton?.classList.remove('sm-session-result-continue--hidden');
            ui.continueButton?.classList.add('sm-session-result-continue--ready');
        }, cfg.buttonRevealDelayMs, rid);
        schedTimeout(() => { page?.classList.remove('sm-session-result-page--playing'); }, cfg.finishCleanupDelayMs, rid);
    }

    function play(totalScore = 0) {
        const ui = ensureUi();
        if (!ui) return;
        const cfg = _getRevealConfig();
        clearTasks(); st.runId += 1;
        const rid = st.runId;
        const safe = Math.max(0, Number(totalScore) || 0);
        const text = String(safe);
        const page = root.querySelector('[data-testid="result-page"][data-result-variant="report-card"]');

        ui.scoreNode.textContent = text;
        ui.scoreNode.classList.remove('sm-session-result-score-source--hidden');
        ui.scoreStage.classList.remove('is-visible', 'is-finished');
        ui.continueButton?.classList.add('sm-session-result-continue--hidden');
        ui.continueButton?.classList.remove('sm-session-result-continue--ready');
        ui.scoreCard.dataset.revealState = 'intro';
        page?.classList.add('sm-session-result-page--playing');
        ui.rowNodes.forEach((row, i) => {
            row.classList.add('sm-session-result-row--intro');
            row.style.setProperty('--sm-session-result-row-delay', `${cfg.rowIntroDelayMs + i * cfg.rowIntroStepMs}ms`);
        });
        if (ui.scoreReels) ui.scoreReels.innerHTML = '';

        schedRaf(() => {
            schedRaf(() => {
                const cur = ensureUi();
                if (!cur?.scoreReels) return;
                syncStack();
                cur.scoreNode.classList.add('sm-session-result-score-source--hidden');
                cur.scoreStage.classList.add('is-visible');
                cur.scoreReels.innerHTML = _buildReelsMarkup(safe, _measureDigitWidths(cur.scoreNode, text));
                const reels = [...cur.scoreReels.querySelectorAll('.sm-session-result-reel')];
                if (!reels.length) { finish(safe, rid); return; }
                const boost = Math.max(0, text.length - 1) * 90;
                let longest = 0;
                reels.forEach((reel) => {
                    const track = reel.querySelector('.sm-session-result-reel-track');
                    if (!track) return;
                    track.style.transition = 'none'; track.style.transform = 'translateY(0)';
                });
                void cur.scoreStage.offsetHeight;
                startTickLoop(rid);
                reels.forEach((reel, i) => {
                    const track = reel.querySelector('.sm-session-result-reel-track');
                    if (!track) return;
                    const h = parseFloat(getComputedStyle(reel).height) || parseFloat(getComputedStyle(reel).fontSize) || 10;
                    const off = Math.max(0, track.children.length - 1) * h;
                    const dur = cfg.baseRollDurationMs + boost + i * cfg.perDigitDurationMs;
                    longest = Math.max(longest, dur);
                    track.style.transition = `transform ${dur}ms cubic-bezier(0.14, 0.92, 0.2, 1)`;
                    track.style.transform = `translateY(${-off}px)`;
                });
                schedTimeout(() => finish(safe, rid), longest + 40, rid);
            }, rid);
        }, rid);
    }

    function destroy() {
        reset(); st.resizeObserver?.disconnect(); st.resizeObserver = null; st.observedScoreNode = null;
    }

    return { play, reset, destroy };
}

// =================== 数据规范化 ===================

function _normalizeLevelSummary(level, source = {}) {
    return {
        level,
        label: source.label || '',
        score: _toNumber(source.score),
        // 支持两种命名：clears/errors（家常乐消消）或 correct/wrong（超市购物）
        clears: _toNumber(source.clears ?? source.correct),
        errors: _toNumber(source.errors ?? source.wrong),
    };
}

/**
 * 将原始等级数据规范化为标准 summary 对象
 * @param {Array} levelStats - 等级统计数组
 * @param {number} totalScore - 总分
 * @returns {{ totalScore: number, levels: Array }}
 */
export function buildResultSummary(levelStats, totalScore = 0) {
    const levels = LEVEL_ORDER.map((level) => {
        const source = Array.isArray(levelStats)
            ? levelStats.find((item) => Number(item?.level) === level) || {}
            : levelStats?.[level] || {};
        return _normalizeLevelSummary(level, source);
    });
    return { totalScore: _toNumber(totalScore), levels };
}

// =================== 公共 API ===================

/**
 * 创建 report-card 结果页组件
 *
 * @param {Object} options
 * @param {HTMLElement} options.mountNode - 挂载节点（必须）
 * @param {string} [options.gameTitle=''] - 品牌卡：游戏名称
 * @param {string} [options.abilityLabel=''] - 品牌卡：能力标签（brandTags 为空时 fallback）
 * @param {string[]} [options.brandTags=[]] - 品牌卡：标签列表
 * @param {string} [options.iconHtml=''] - 品牌卡：自定义 icon HTML（优先于 iconSrc）
 * @param {string} [options.iconSrc=''] - 品牌卡：icon 图片 URL
 * @param {string} [options.iconAlt=''] - 品牌卡：icon alt 文本
 * @param {string} [options.headerTitle='训练完成'] - 顶部标题
 * @param {string} [options.backgroundImageSrc=''] - 全屏背景图 URL
 * @param {string} [options.continueText='继续'] - 继续按钮文案
 * @param {string} [options.continueTestId='continue-btn'] - 继续按钮 data-testid
 * @param {string} [options.className=''] - 自定义 CSS 类名（如 'sm-session-ui--housework'）
 * @param {string} [options.badMetricLabel='失误'] - 结果行「错误指标」的无障碍标签文案
 * @param {Function} [options.onContinue] - 点击继续按钮回调
 * @param {Function} [options.onBack] - 点击返回按钮回调
 */
export function createResultPage({
    mountNode,
    gameTitle = '',
    abilityLabel = '',
    brandTags = [],
    iconHtml = '',
    iconSrc = '',
    iconAlt = '',
    headerTitle = '训练完成',
    backgroundImageSrc = '',
    continueText = '继续',
    continueTestId = 'continue-btn',
    className = '',
    badMetricLabel = '失误',
    onContinue,
    onBack,
} = {}) {
        const isDailyRecommend = _isDailyRecommendGame();
        const resolvedContinueText = isDailyRecommend
            ? (_isLastDailyRecommendGame() ? '完成今日训练' : '进入下一项训练')
            : continueText;

    if (!mountNode) throw new Error('createResultPage 需要 mountNode');

    // 构建 DOM
    const html = _buildResultPageHtml({
        headerTitle, gameTitle, abilityLabel, iconAlt, iconSrc, iconHtml,
        backgroundImageSrc, brandTags, continueText: resolvedContinueText, continueTestId, isDailyRecommend,
    });

    const wrapper = _buildElement(`<div class="sm-result-page-root ${className}" data-result-variant="report-card">${html}</div>`);
    // 与 .sm-session-layer 一致的全屏覆盖定位
    Object.assign(wrapper.style, { position: 'absolute', inset: '0', zIndex: '170', pointerEvents: 'none' });
    mountNode.appendChild(wrapper);

    // 设置背景图 CSS 变量
    const bgNode = wrapper.querySelector('.sm-session-result-bg');
    if (bgNode) bgNode.style.setProperty('--sm-session-result-bg-image', _toCssUrl(backgroundImageSrc));

    // 初始化分数揭示控制器
    const scoreReveal = _createScoreRevealController(wrapper);

    // 绑定事件
    wrapper.querySelectorAll('[data-session-action="continue"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (isDailyRecommend) {
                exitToGameList({ dailyRecommendAction: 'next' });
                return;
            }
            // 继续训练前先清结算层残留，避免分数动画/时间到浮层/生命周期标志污染新一局
            scoreReveal.reset();
            wrapper.querySelector('[data-testid="result-page"]')?.classList.add('hidden');
            hideTimeUp();


            if (typeof onContinue === 'function') onContinue();
        });
    });
    // 返回按钮固定回游戏列表；未传 onBack 时不再回退到 onContinue（继续训练已改为重开本局）
    wrapper.querySelector('[data-session-action="back"]')?.addEventListener('click', () => {
        if (typeof onBack === 'function') onBack();
        else exitToGameList();
    });

    // =================== 内部方法 ===================

    function resolveLevelStatsSource(summary) {
        if (Array.isArray(summary?.levels)) {
            return summary.levels.length ? summary.levels : null;
        }
        if (Array.isArray(summary)) {
            return summary.length ? summary : null;
        }
        if (!summary || typeof summary !== 'object') {
            return null;
        }
        const hasLevelMap = LEVEL_ORDER.some((level) => summary[level] || summary[String(level)]);
        return hasLevelMap ? summary : null;
    }

    function renderResult(summary = {}) {
        const levelsSource = resolveLevelStatsSource(summary);
        const normalized = levelsSource
            ? buildResultSummary(levelsSource, summary.totalScore ?? summary.score)
            : {
                totalScore: _toNumber(summary.totalScore ?? summary.score),
                levels: [],
            };
        const scoreNode = wrapper.querySelector('[data-session-role="total-score"]');
        if (scoreNode) scoreNode.textContent = String(normalized.totalScore);
        const boardNode = wrapper.querySelector('#result-stats');
        if (boardNode) {
            boardNode.innerHTML = normalized.levels.length ? _buildRowsHtml(normalized.levels, { badMetricLabel }) : '';
            boardNode.setAttribute('data-result-has-rows', normalized.levels.length ? 'true' : 'false');
            boardNode.classList.toggle('sm-session-result-board-card--empty', normalized.levels.length === 0);
        }
        return normalized;
    }

    // =================== 返回公共 API ===================

    return {
        /** 组件根 DOM 节点 */
        root: wrapper,

        /**
         * 渲染结果数据（不触发动画）
         * @param {{ levels?: Array, totalScore?: number, score?: number }} summary
         */
        renderResult,

        /**
         * 显示结果页并播放分数揭示动画
         * @param {{ levels?: Array, totalScore?: number, score?: number }} summary
         */
        showResult(summary) {
            const normalized = renderResult(summary);
            const page = wrapper.querySelector('[data-testid="result-page"]');
            page?.classList.remove('hidden');
            scoreReveal.play(normalized.totalScore);
        },

        /** 隐藏结果页 */
        hideResult() {
            scoreReveal.reset();
            const page = wrapper.querySelector('[data-testid="result-page"]');
            page?.classList.add('hidden');
        },

        /** 更新顶部标题 */
        setHeaderTitle(title) {
            const node = wrapper.querySelector('[data-session-role="header-title"]');
            if (node) node.textContent = title;
        },

        /**
         * 更新品牌卡标签
         * @param {string[]} tags
         */
        setBrandTags(tags) {
            const node = wrapper.querySelector('[data-session-role="brand-tags"]');
            if (!node) return;
            const normalized = _normalizeTags(tags, abilityLabel);
            node.innerHTML = normalized.map((t) => `<span class="sm-session-result-tag">${_escHtml(t)}</span>`).join('');
        },

        /**
         * 更新品牌卡游戏名称
         * @param {string} title
         */
        setGameTitle(title) {
            const node = wrapper.querySelector('[data-session-role="game-title"]');
            if (node) node.textContent = title;
        },

        /**
         * 更新品牌卡图标
         * @param {string} src - 图片 URL
         * @param {string} [alt]
         */
        setIconSource(src, alt) {
            const img = wrapper.querySelector('.sm-session-result-icon-img');
            if (!img) return;
            img.src = src;
            if (alt) img.alt = alt;
        },

        /**
         * 更新品牌卡图标 HTML（整体替换）
         * @param {string} html
         */
        setIconHtml(html) {
            const container = wrapper.querySelector('[data-session-role="icon"]');
            if (container) container.innerHTML = html;
        },

        /**
         * 更新全屏背景图
         * @param {string} src
         */
        setBackgroundImage(src) {
            const bg = wrapper.querySelector('.sm-session-result-bg');
            if (bg) bg.style.setProperty('--sm-session-result-bg-image', _toCssUrl(src));
            const img = wrapper.querySelector('.sm-session-result-bg-img');
            if (img) img.src = src || '';
        },

        /** 销毁组件 */
        destroy() {
            scoreReveal.destroy();
            wrapper.remove();
        },
    };
}
