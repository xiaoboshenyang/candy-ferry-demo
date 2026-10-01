import { preloadGameFeedbackAudio } from '../feedback-audio/game-feedback-audio.js';
import { freezeLayerAnimations, isLayerAnimationsFrozen, unfreezeLayerAnimations } from '../utils/freeze-layer-animations.js';
import {
    getGameAudioContext,
    installGameAudioUnlockListeners,
    peekGameAudioContext,
    unlockGameAudio,
} from '../audio/game-audio-context.js';
import { getSharedGameSfxPlayer } from '../audio/game-sfx.js';

/**
 * 游戏通用组件 - 等级提升
 * 提供统一的等级提升提示遮罩、动画和可选音效
 */

const HIDE_TRANSITION_MS = 260;
const LEVEL_UP_AUDIO_ENABLED_DEFAULT = false;
const LEVEL_UP_SOUND_KIND_DEFAULT = 'levelUp';
const LEVEL_UP_SYNTH_SOUND_ID = 'levelUpSynth';
// 升级音相对共享 success 的混音微调（不是用户音量；用户音量走 sfx.volume）
const LEVEL_UP_FEEDBACK_GAIN = 0.7;
const LEVEL_UP_AUDIO_RESUME_TIMEOUT_MS = 1200;
const LEVEL_UP_ANIMATION_PREPARE_FRAMES = 2;
const OVERLAY_FREEZE_CLASS = 'sm-game-overlay-freeze';
const TIMER_WARNING_FREEZE_CLASS = 'sm-timer-warning-frozen';
const REM_BASE = 10;

const LEVEL_UP_LAYOUT = {
    minWidth: 236,
    maxWidth: 420,
    pillHeight: 108,
    iconSize: 146,
    paddingLeft: 84,
    paddingRight: 22,
    charWidth: 40,
    charGap: 12,
    anchorShiftMax: 72,
};

let levelUpOverlay = null;
let levelUpTrack = null;
let levelUpPillMask = null;
let levelUpText = null;
let hideTimeout = null;
let completionTimeout = null;
let audioUnlockInstalled = false;
let levelUpSynthRegistered = false;
// 时间到（结算）动画一旦触发，必须压住后续等级提升动画，避免两者抢占同一全局 overlay。
// 任意一局结束后，需通过 hideTimeUp() 或 resetOverlayLock() 主动解锁，下一局才能再次播放升级动画。
let timeUpLockActive = false;
// 默认升级图标只解析写入一次；未传自定义 iconSvg 时跳过重复 innerHTML 写入
let levelUpDefaultIconReady = false;
let levelUpIconIsCustom = false;
let overlayFreezeHost = null;
let overlayOwnsLayerFreeze = false;

function getGameDiag() {
    return window.__SMGameDiag || null;
}

function emitLevelUpDiag(event, detail = {}) {
    try {
        getGameDiag()?.log?.(event, detail);
    } catch (_error) {
        // 诊断通道只做旁路记录，不能影响正式游戏流程。
    }
}

function describeContainer(container) {
    if (!(container instanceof Element)) {
        return null;
    }

    const idPart = container.id ? `#${container.id}` : '';
    const classPart = container.classList?.length
        ? `.${Array.from(container.classList).slice(0, 4).join('.')}`
        : '';

    return `${container.tagName.toLowerCase()}${idPart}${classPart}`;
}

function getAudioContextSnapshot(context) {
    if (!context) {
        return { available: false };
    }

    return {
        available: true,
        state: context.state,
        currentTime: Number(context.currentTime.toFixed(3)),
    };
}

function toRem(value) {
    return `${value / REM_BASE}rem`;
}

function createLevelUpIconSvg() {
    return `
        <svg class="sm-game-level-up-icon__svg" viewBox="0 0 176 176" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
            <defs>
                <radialGradient id="smLevelIconBg" cx="50%" cy="38%" r="70%">
                    <stop offset="0%" stop-color="#ffb24e" />
                    <stop offset="62%" stop-color="#ff8d1f" />
                    <stop offset="100%" stop-color="#f66e00" />
                </radialGradient>
                <linearGradient id="smLevelIconArrow" x1="50%" y1="0%" x2="50%" y2="100%">
                    <stop offset="0%" stop-color="#fff3a8" />
                    <stop offset="100%" stop-color="#ffc625" />
                </linearGradient>
            </defs>
            <circle cx="88" cy="88" r="82" fill="#fff7f0" />
            <circle cx="88" cy="88" r="72" fill="url(#smLevelIconBg)" />
            <path
                d="M88 42C91.6 42 95.1 43.5 97.6 46.1L129 78C136 85.2 130.9 97.4 120.8 97.4H112.8V122.3C112.8 130.2 106.4 136.6 98.5 136.6H77.5C69.6 136.6 63.2 130.2 63.2 122.3V97.4H55.2C45.1 97.4 40 85.2 47 78L78.4 46.1C80.9 43.5 84.4 42 88 42Z"
                fill="url(#smLevelIconArrow)"
                stroke="#ffca3f"
                stroke-width="5"
                stroke-linejoin="round"
            />
            <path
                d="M88 56L114 82H102V121H74V82H62L88 56Z"
                fill="#ffe88d"
                opacity="0.52"
            />
        </svg>
    `;
}

function getVisibleCharacters(text) {
    const value = String(text ?? '').trim();
    return value ? Array.from(value) : Array.from('等级提升');
}

function computeLevelUpMetrics(text) {
    const charCount = getVisibleCharacters(text).length;
    const gapCount = Math.max(0, charCount - 1);
    const width = Math.min(
        LEVEL_UP_LAYOUT.maxWidth,
        Math.max(
            LEVEL_UP_LAYOUT.minWidth,
            LEVEL_UP_LAYOUT.paddingLeft +
                LEVEL_UP_LAYOUT.paddingRight +
                (charCount * LEVEL_UP_LAYOUT.charWidth) +
                (gapCount * LEVEL_UP_LAYOUT.charGap)
        )
    );

    return {
        pillWidth: width,
        anchorShift: -Math.min(width * 0.2, LEVEL_UP_LAYOUT.anchorShiftMax),
        iconShift: -Math.max(LEVEL_UP_LAYOUT.iconSize * 0.2, 28),
    };
}

function clearLevelUpTimers() {
    const hadHideTimeout = Boolean(hideTimeout);
    const hadCompletionTimeout = Boolean(completionTimeout);
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
    if (completionTimeout) {
        clearTimeout(completionTimeout);
        completionTimeout = null;
    }
    if (hadHideTimeout || hadCompletionTimeout) {
        emitLevelUpDiag('overlay:timers-cleared', {
            hideTimeout: hadHideTimeout,
            completionTimeout: hadCompletionTimeout,
        });
    }
}

function runAfterAnimationPrepareFrames(callback, frames = LEVEL_UP_ANIMATION_PREPARE_FRAMES) {
    if (typeof callback !== 'function') {
        return;
    }

    if (frames <= 0) {
        callback();
        return;
    }

    requestAnimationFrame(() => {
        runAfterAnimationPrepareFrames(callback, frames - 1);
    });
}

function getLevelUpAudioContext() {
    return peekGameAudioContext();
}

/**
 * 解锁共享 AudioContext（旧名保留，内部转发 unlockGameAudio）。
 * @returns {Promise<AudioContext|null>}
 */
export function resumeLevelUpAudioContext(options = {}) {
    const {
        source = 'unknown',
        timeoutMs = LEVEL_UP_AUDIO_RESUME_TIMEOUT_MS,
    } = options;
    const before = getGameAudioContext();
    if (!before) {
        emitLevelUpDiag('audio:resume-skipped', { source, reason: 'no-context' });
        return Promise.resolve(null);
    }
    if (before.state === 'running') {
        emitLevelUpDiag('audio:resume-skipped', {
            source,
            reason: 'state-not-suspended',
            ...getAudioContextSnapshot(before),
        });
        return Promise.resolve(before);
    }

    emitLevelUpDiag('audio:resume-requested', { source, ...getAudioContextSnapshot(before) });
    return unlockGameAudio({ source, timeoutMs }).then((context) => {
        emitLevelUpDiag(context ? 'audio:resume-resolved' : 'audio:resume-timeout', {
            source,
            timeoutMs,
            ...getAudioContextSnapshot(context || before),
        });
        return context;
    });
}

function installAudioUnlock() {
    if (audioUnlockInstalled) {
        return;
    }
    audioUnlockInstalled = true;
    // 共享兜底监听：pointerdown / touchend / keydown / visibilitychange → unlockGameAudio
    installGameAudioUnlockListeners();
    emitLevelUpDiag('audio:unlock-installed', { event: 'shared-unlock-listeners' });
}

export function prepareLevelUpAudio(options = {}) {
    const {
        source = 'unknown',
        preload = true,
        resume = false,
        timeoutMs = LEVEL_UP_AUDIO_RESUME_TIMEOUT_MS,
    } = options;

    installAudioUnlock();

    if (preload) {
        preloadGameFeedbackAudio(LEVEL_UP_SOUND_KIND_DEFAULT);
        preloadGameFeedbackAudio('timeUp');
        emitLevelUpDiag('audio:preload-requested', {
            source,
            sounds: [LEVEL_UP_SOUND_KIND_DEFAULT, 'timeUp'],
        });
    }

    if (!resume) {
        emitLevelUpDiag('audio:prepare-complete', { source, resume });
        return Promise.resolve(null);
    }

    emitLevelUpDiag('audio:prepare-resume', { source, timeoutMs });
    return resumeLevelUpAudioContext({ source, timeoutMs });
}

/**
 * 合成一段升级琶音。destination 由 SFX 播放器传入（已是该音效的 voiceGain），
 * 因此合成兜底同样受「音效」开关、音量与主总线限幅约束，不再直连 ctx.destination。
 */
function scheduleLevelUpTone(context, destination, {
    startFreq,
    endFreq = startFreq,
    duration = 0.16,
    type = 'triangle',
    volume = 0.05,
    attack = 0.012,
    startDelay = 0,
    pan = 0,
    now,
}) {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const canPan = typeof context.createStereoPanner === 'function';
    const panner = canPan ? context.createStereoPanner() : null;
    const startAt = now + startDelay;
    const safeAttack = Math.max(0.008, Math.min(attack, duration * 0.5));
    const releaseAt = startAt + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFreq, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), releaseAt);

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + safeAttack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

    oscillator.connect(gainNode);
    if (panner) {
        panner.pan.setValueAtTime(pan, startAt);
        gainNode.connect(panner);
        panner.connect(destination);
    } else {
        gainNode.connect(destination);
    }

    oscillator.start(startAt);
    oscillator.stop(releaseAt + 0.02);
    return releaseAt + 0.02 - now;
}

const LEVEL_UP_SYNTH_NOTES = Object.freeze([
    { startFreq: 523.25, endFreq: 587.33, duration: 0.13, type: 'sine', volume: 0.038, attack: 0.014, pan: -0.08 },
    { startFreq: 659.25, endFreq: 783.99, duration: 0.14, type: 'triangle', volume: 0.044, attack: 0.014, startDelay: 0.055, pan: -0.02 },
    { startFreq: 783.99, endFreq: 987.77, duration: 0.16, type: 'sine', volume: 0.05, attack: 0.016, startDelay: 0.115, pan: 0.05 },
    { startFreq: 1046.5, endFreq: 1318.51, duration: 0.2, type: 'triangle', volume: 0.058, attack: 0.018, startDelay: 0.185, pan: 0.1 },
    { startFreq: 1318.51, endFreq: 1567.98, duration: 0.16, type: 'sine', volume: 0.026, attack: 0.01, startDelay: 0.265, pan: 0.16 },
]);

function levelUpSynth({ ctx, destination, now }) {
    emitLevelUpDiag('audio:synth-play-requested', getAudioContextSnapshot(ctx));
    let durationSec = 0;
    LEVEL_UP_SYNTH_NOTES.forEach((note) => {
        durationSec = Math.max(durationSec, scheduleLevelUpTone(ctx, destination, { ...note, now }));
    });
    return { durationSec };
}

function ensureLevelUpSynthRegistered(player) {
    if (levelUpSynthRegistered && player.has(LEVEL_UP_SYNTH_SOUND_ID)) return;
    player.register(LEVEL_UP_SYNTH_SOUND_ID, {
        synth: levelUpSynth,
        gain: LEVEL_UP_FEEDBACK_GAIN,
        mode: 'restart',
        throttleMs: 120,
    });
    levelUpSynthRegistered = true;
}

/**
 * 升级 / 时间到音效走共享 SFX bank：受 sfx.enabled 与 sfx.volume 控制。
 * levelUp 素材缺失时回退到合成琶音（同样经 SFX 总线）。
 */
function playLevelUpSound(sound = LEVEL_UP_SOUND_KIND_DEFAULT) {
    emitLevelUpDiag('audio:play-requested', { sound });
    const player = getSharedGameSfxPlayer();
    if (!player.getEnabled()) {
        emitLevelUpDiag('audio:play-skipped', { sound, reason: 'sfx-disabled' });
        return false;
    }

    if (player.has(sound) && player.isReady(sound)) {
        const handle = player.play(sound, { gain: LEVEL_UP_FEEDBACK_GAIN });
        emitLevelUpDiag(handle ? 'audio:oneshot-play-requested' : 'audio:oneshot-unavailable', { sound });
        if (handle) return true;
    } else if (player.has(sound)) {
        // 素材尚未解码：触发懒加载，本次用合成兜底（仅 levelUp）
        void player.preload([sound]);
        emitLevelUpDiag('audio:oneshot-unavailable', { sound, reason: 'buffer-not-ready' });
    }

    if (sound !== LEVEL_UP_SOUND_KIND_DEFAULT) {
        return false;
    }

    ensureLevelUpSynthRegistered(player);
    const synthHandle = player.play(LEVEL_UP_SYNTH_SOUND_ID);
    if (!synthHandle) {
        emitLevelUpDiag('audio:synth-skipped', { state: getLevelUpAudioContext()?.state || 'missing' });
    }
    return Boolean(synthHandle);
}

function setLevelUpText(text) {
    if (!levelUpText) {
        return;
    }
    const chars = getVisibleCharacters(text);
    levelUpText.replaceChildren(...chars.map((char, index) => {
        const span = document.createElement('span');
        span.className = 'sm-game-level-up-char';
        span.style.setProperty('--sm-char-delay', `${0.38 + (index * 0.09)}s`);
        span.textContent = char;
        return span;
    }));
}

function applyLevelUpMetrics(text) {
    if (!levelUpOverlay) {
        return;
    }
    const metrics = computeLevelUpMetrics(text);
    levelUpOverlay.style.setProperty('--sm-level-up-pill-width', toRem(metrics.pillWidth));
    levelUpOverlay.style.setProperty('--sm-level-up-anchor-shift', toRem(metrics.anchorShift));
    levelUpOverlay.style.setProperty('--sm-level-up-icon-shift', toRem(metrics.iconShift));
}

/**
 * 替换图标区域的 SVG 内容。
 * @param {string|null} [iconSvg=null] - 自定义 SVG；null/省略时使用默认图标（已写入则跳过）
 */
function setLevelUpIcon(iconSvg = null) {
    if (!levelUpOverlay) {
        return;
    }
    const iconInner = levelUpOverlay.querySelector('.sm-game-level-up-icon__inner');
    if (!iconInner) {
        return;
    }

    if (iconSvg) {
        iconInner.innerHTML = iconSvg;
        levelUpIconIsCustom = true;
        return;
    }

    // 默认图标已在 DOM 中且未被自定义覆盖 → 跳过重复解析
    if (levelUpDefaultIconReady && !levelUpIconIsCustom) {
        return;
    }

    iconInner.innerHTML = createLevelUpIconSvg();
    levelUpDefaultIconReady = true;
    levelUpIconIsCustom = false;
}

function setBackdropActive(active) {
    if (!levelUpOverlay) {
        return;
    }
    levelUpOverlay.classList.toggle('is-backdrop-on', Boolean(active));
}

function getTimerDisplay() {
    return document.getElementById('timerDisplay');
}

function freezeTimerWarningPulse() {
    const timer = getTimerDisplay();
    if (!(timer instanceof Element)) return;
    timer.classList.add(TIMER_WARNING_FREEZE_CLASS);
    // 顶栏可能不在升级 container 子树；warning 也可能是宿主 freeze 之后才加上的。
    freezeLayerAnimations(timer);
}

function unfreezeTimerWarningPulse() {
    const timer = getTimerDisplay();
    if (!(timer instanceof Element)) return;
    timer.classList.remove(TIMER_WARNING_FREEZE_CLASS);
    unfreezeLayerAnimations(timer);
}

function freezeOverlayHost(host, { freezeHostAnimations = true } = {}) {
    if (!(host instanceof Element)) return;
    unfreezeOverlayHost();
    overlayFreezeHost = host;
    host.classList.add(OVERLAY_FREEZE_CLASS);
    // CSS 的 .sm-game-overlay-freeze 规则已经免费冻住所有 `animation` 属性；
    // 这里的 getAnimations() 全子树扫描只对 CSS transition / WAAPI 有意义，且会强制 flush 样式布局。
    // freezeHostAnimations=false 时调用方已确认宿主内没有需要靠 JS 暂停的 transition，跳过整个扫描。
    // freezeLayerAnimations 同一节点只能记一份；已有暂停冻结时只加 CSS class，避免结束时误恢复暂停动画。
    overlayOwnsLayerFreeze = freezeHostAnimations && !isLayerAnimationsFrozen(host);
    if (overlayOwnsLayerFreeze) {
        freezeLayerAnimations(host, {
            skip: host.querySelector('.sm-game-level-up-toast') || levelUpOverlay,
        });
    }
    freezeTimerWarningPulse();
}

function unfreezeOverlayHost() {
    if (overlayFreezeHost) {
        overlayFreezeHost.classList.remove(OVERLAY_FREEZE_CLASS);
        if (overlayOwnsLayerFreeze) {
            unfreezeLayerAnimations(overlayFreezeHost);
        }
    }
    overlayOwnsLayerFreeze = false;
    overlayFreezeHost = null;
    unfreezeTimerWarningPulse();
}

function wrapOverlayComplete(onComplete) {
    return () => {
        unfreezeOverlayHost();
        if (typeof onComplete === 'function') onComplete();
    };
}

export function initLevelUpOverlay(container = document.body) {
    installAudioUnlock();

    if (!levelUpOverlay) {
        levelUpOverlay = document.createElement('div');
        levelUpOverlay.className = 'sm-game-level-up-toast';
        levelUpOverlay.innerHTML = `
            <div class="sm-game-level-up-backdrop" aria-hidden="true"></div>
            <div class="sm-game-level-up-track" aria-hidden="true">
                <div class="sm-game-level-up-pill-mask">
                    <div class="sm-game-level-up-pill">
                        <div class="sm-game-level-up-pill__shine"></div>
                        <div class="sm-game-level-up-text"></div>
                    </div>
                </div>
                <div class="sm-game-level-up-icon">
                    <div class="sm-game-level-up-icon__inner">
                        ${createLevelUpIconSvg()}
                    </div>
                </div>
            </div>
        `;

        levelUpTrack = levelUpOverlay.querySelector('.sm-game-level-up-track');
        levelUpPillMask = levelUpOverlay.querySelector('.sm-game-level-up-pill-mask');
        levelUpText = levelUpOverlay.querySelector('.sm-game-level-up-text');
        // 模板已内嵌默认 SVG，标记就绪，后续 showLevelUp 未传 iconSvg 时不再重写
        levelUpDefaultIconReady = true;
        levelUpIconIsCustom = false;
        emitLevelUpDiag('overlay:created', {
            target: describeContainer(levelUpOverlay),
        });
    }

    if (levelUpOverlay.parentElement !== container) {
        container.appendChild(levelUpOverlay);
        emitLevelUpDiag('overlay:attached', {
            container: describeContainer(container),
        });
        // overlay 被挂到新的容器（典型场景：上一局结算完后用户重新开局），
        // 释放可能残留的结算锁，避免新一局升级动画被持续屏蔽。
        if (timeUpLockActive) {
            timeUpLockActive = false;
            emitLevelUpDiag('overlay:time-up-lock', { active: false, reason: 'container-change' });
        }
    }

    return levelUpOverlay;
}

export function hideLevelUp(options = {}) {
    const { onComplete = null } = options;
    const wrappedOnComplete = wrapOverlayComplete(onComplete);
    if (!levelUpOverlay || !levelUpTrack) {
        emitLevelUpDiag('overlay:hide-skipped', { reason: 'missing-overlay' });
        wrappedOnComplete();
        return;
    }

    clearLevelUpTimers();
    emitLevelUpDiag('overlay:hide-requested', {
        className: levelUpTrack.className,
        backdropOn: levelUpOverlay.classList.contains('is-backdrop-on'),
    });
    beginLevelUpHide({ onComplete: wrappedOnComplete, reason: 'manual' });
}

function startLevelUpAnimation({ duration, onComplete, playSound, sound }) {
    if (!levelUpOverlay || !levelUpTrack) {
        emitLevelUpDiag('overlay:animation-skipped', { reason: 'missing-overlay' });
        unfreezeOverlayHost();
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    clearLevelUpTimers();
    // 显示状态类只挂在内容 track（含 pill-mask）上；模糊层 is-backdrop-on 在播放过程中保持不动。
    levelUpTrack.classList.remove('is-visible', 'is-playing', 'is-hiding', 'is-resetting');
    // 首次挂载后需要先让 hidden 初始态完成一次绘制，否则浏览器会把首帧与目标态合并，
    // 导致第一次显示直接跳到最终位置而不走过渡。
    runAfterAnimationPrepareFrames(() => {
        if (!levelUpTrack) {
            return;
        }

        emitLevelUpDiag('overlay:animation-started', {
            duration,
            playSound,
            sound,
        });

        levelUpTrack.classList.add('is-visible', 'is-playing');

        if (playSound) {
            playLevelUpSound(sound);
        }

        if (levelUpOverlay?.parentElement?.dataset.shellManaged === "true") return;
        hideTimeout = setTimeout(() => {
            emitLevelUpDiag('overlay:auto-hide-fired', {
                duration,
                className: levelUpTrack.className,
            });
            beginLevelUpHide({ onComplete, reason: 'auto' });
        }, Math.max(200, duration));
    });
}

function resetLevelUpOverlayState() {
    if (!levelUpTrack) {
        return;
    }

    levelUpTrack.classList.add('is-resetting');
    levelUpTrack.classList.remove('is-visible', 'is-playing', 'is-hiding');
    // 内容退场完成后再关遮罩，播放中途不改动模糊层样式。
    setBackdropActive(false);
    // 用 rAF 替代 void offsetWidth，避免强制同步重排
    requestAnimationFrame(() => {
        if (levelUpTrack) levelUpTrack.classList.remove('is-resetting');
    });
}

function beginLevelUpHide({ onComplete = null, reason = 'manual' } = {}) {
    if (!levelUpOverlay || !levelUpTrack) {
        emitLevelUpDiag('overlay:hide-skipped', { reason: 'missing-overlay' });
        unfreezeOverlayHost();
        if (typeof onComplete === 'function') {
            onComplete();
        }
        return;
    }

    if (!levelUpTrack.classList.contains('is-visible')) {
        resetLevelUpOverlayState();
        emitLevelUpDiag('overlay:hide-complete', {
            reason,
            className: levelUpTrack.className,
        });
        unfreezeOverlayHost();
        if (typeof onComplete === 'function') {
            onComplete();
        }
        return;
    }

    levelUpTrack.classList.remove('is-playing');
    levelUpTrack.classList.add('is-hiding');
    emitLevelUpDiag('overlay:hide-transition-started', {
        reason,
        className: levelUpTrack.className,
        backdropOn: levelUpOverlay.classList.contains('is-backdrop-on'),
    });

    completionTimeout = setTimeout(() => {
        completionTimeout = null;
        resetLevelUpOverlayState();
        emitLevelUpDiag('overlay:hide-complete', {
            reason,
            className: levelUpTrack?.className,
        });
        unfreezeOverlayHost();
        if (typeof onComplete === 'function') {
            emitLevelUpDiag('overlay:on-complete');
            onComplete();
        }
    }, HIDE_TRANSITION_MS);
}

/**
 * 显示等级提升遮罩
 * @param {Object} options
 * @param {string} [options.text='等级提升啦！'] - 提示文本
 * @param {number} [options.duration=1500] - 显示持续时间(ms)
 * @param {HTMLElement} [options.container=document.body] - 挂载容器
 * @param {boolean} [options.backdrop=true] - 是否显示背景遮罩
 * @param {boolean} [options.playSound=false] - 是否播放升级音效
 * @param {string} [options.sound='levelUp'] - 播放的提示音类型
 * @param {Function} [options.onComplete] - 动画结束回调
 * @param {boolean} [options.freezeHostAnimations=true] - 是否用 JS 扫描并暂停 container 内的 CSS transition/WAAPI；
 *   `animation` 属性已由 CSS 规则免费冻结，与本选项无关。调用方确认宿主内没有活跃 transition 时可传 false 跳过全子树扫描。
 *
 * 显示期间会冻结 `container` 内除浮层自身外的 CSS / WAAPI 动画，
 * 并冻结顶栏倒计时 warning 闪烁，避免 backdrop-filter 每帧采样仍在动的画面。
 * Canvas / Pixi 循环仍须游戏自行暂停。
 */
export function showLevelUp(options = {}) {
    const {
        text = '等级提升啦！',
        duration = 1500,
        container = document.body,
        backdrop = true,
        playSound = LEVEL_UP_AUDIO_ENABLED_DEFAULT,
        sound = LEVEL_UP_SOUND_KIND_DEFAULT,
        onComplete = null,
        iconSvg = null,
        freezeHostAnimations = true,
        __bypassTimeUpLock = false,
    } = options;

    // 时间到优先：若结算动画已锁定 overlay，直接吞掉后续升级请求，避免抢占动画或恢复已结束的游戏循环。
    if (timeUpLockActive && !__bypassTimeUpLock) {
        emitLevelUpDiag('overlay:skip-time-up-locked', {
            text,
            duration,
            sound,
        });
        return;
    }

    initLevelUpOverlay(container);
    const host = container instanceof Element ? container : document.body;
    // 先冻住宿主画面，再打开模糊层，避免首帧采样到仍在动的内容。
    freezeOverlayHost(host, { freezeHostAnimations });
    setLevelUpIcon(iconSvg);
    setLevelUpText(text);
    applyLevelUpMetrics(text);
    // 模糊层只在展示开始时开关一次；播放/退场过程不再改动其样式类。
    setBackdropActive(backdrop);
    emitLevelUpDiag('overlay:show-requested', {
        text,
        duration,
        backdrop,
        playSound,
        sound,
        container: describeContainer(container),
    });

    const runAnimation = () => {
        emitLevelUpDiag('overlay:animation-dispatched', {
            text,
            duration,
            playSound,
            sound,
        });
        startLevelUpAnimation({
            duration,
            onComplete,
            playSound,
            sound,
        });
    };

    if (playSound) {
        // 恢复 AudioContext 与动画起播解耦并行执行：等音频 resume 完成再起播会让起播时机
        // 落在一个不确定的宏任务边界上（0~上限不等），反而更容易撞上其它主线程工作。
        // 恢复不完成时 playLevelUpTone/playLevelUpSynthSound 会自行按 context.state 跳过播放，不会报错。
        emitLevelUpDiag('overlay:audio-resume-before-animation', { sound });
        void resumeLevelUpAudioContext({ source: `overlay:${sound}` });
    }
    runAnimation();
}

/**
 * 标记结算 overlay 锁定状态。
 * `showTimeUp` 在内部调用本接口；游戏代码一般无需直接使用，除非有自定义结算动画。
 * @param {boolean} active
 */
export function setTimeUpLock(active) {
    const next = !!active;
    if (timeUpLockActive === next) {
        return;
    }
    timeUpLockActive = next;
    emitLevelUpDiag('overlay:time-up-lock', { active: next });
}

/**
 * 当前 overlay 是否已被时间到动画锁定。
 * 游戏代码可据此提前跳过自己的升级触发逻辑。
 */
export function isTimeUpLockActive() {
    return timeUpLockActive;
}

/**
 * 重置 overlay 锁与定时器。新一局开始时调用，确保上一局结算遗留的状态不会压住下一局升级动画。
 */
export function resetOverlayLock() {
    clearLevelUpTimers();
    timeUpLockActive = false;
    unfreezeOverlayHost();
    emitLevelUpDiag('overlay:lock-reset');
}
