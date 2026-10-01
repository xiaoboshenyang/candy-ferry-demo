import { getCachedSharedAudioContext, getSharedAudioContext } from '../utils/shared-audio-context.js';

/**
 * 小游戏唯一 AudioContext 与主总线
 *
 * 目标：
 * 1. BGM、音效、升级音、结果页音、资源解码全部复用同一个 ctx（key 'game-audio'）
 * 2. 主总线 masterGain(1) → DynamicsCompressor（软限幅） → destination，游戏不可绕过
 * 3. unlockGameAudio() 同时处理 'suspended' 与 iOS 的 'interrupted'
 *
 * 禁止在游戏目录内再 `new AudioContext()`。
 */

export const GAME_AUDIO_CONTEXT_KEY = 'game-audio';
const LOG_PREFIX = '[GameAudio]';
const DEFAULT_UNLOCK_TIMEOUT_MS = 1200;

/**
 * 主总线软限幅参数（共享层一处配置，游戏不可覆盖）。
 * loudnessScale / gain 允许 > 1 的前提就是这里存在限幅器。
 */
export const GAME_AUDIO_LIMITER = Object.freeze({
    enabled: true,
    threshold: -6,
    knee: 6,
    ratio: 12,
    attack: 0.003,
    release: 0.25,
});

const UNLOCK_EVENTS = Object.freeze(['pointerdown', 'touchend', 'keydown']);
const RESUMABLE_STATES = new Set(['suspended', 'interrupted']);

// ctx → { masterGain, compressor }
const masterByContext = new WeakMap();
let pendingUnlock = null;
let unlockListenersUninstall = null;

// =================== 增益渐变 ===================

/**
 * 零值安全渐变：exponentialRamp 目标必须 > 0，静音时先到 0.0001 再在终点精确置 0。
 * BGM 的 start / stop / setEnabled / setVolume 与 SFX 总线、循环音效句柄都必须走这里。
 * @param {AudioParam} audioParam
 * @param {number} targetGain
 * @param {number} now ctx.currentTime
 * @param {number} duration 秒
 */
export function rampGainTo(audioParam, targetGain, now, duration) {
    if (!audioParam) return;
    const safeDuration = Math.max(0.005, Number(duration) || 0);
    const safeNow = Number.isFinite(now) ? now : 0;
    audioParam.cancelScheduledValues(safeNow);
    audioParam.setValueAtTime(Math.max(audioParam.value, 0.0001), safeNow);

    if (!(targetGain > 0)) {
        audioParam.exponentialRampToValueAtTime(0.0001, safeNow + safeDuration);
        audioParam.setValueAtTime(0, safeNow + safeDuration);
        return;
    }

    audioParam.exponentialRampToValueAtTime(targetGain, safeNow + safeDuration);
}

// =================== 上下文获取 ===================

/**
 * 获取（必要时创建）小游戏唯一 AudioContext。
 * 宿主 keepwork.audioEngine 存在时优先复用宿主上下文。
 * @param {{ resume?: boolean }} [options]
 * @returns {AudioContext|null}
 */
export function getGameAudioContext({ resume = false } = {}) {
    return getSharedAudioContext({
        key: GAME_AUDIO_CONTEXT_KEY,
        resume,
        logPrefix: LOG_PREFIX,
    });
}

/**
 * 只读取已创建的 ctx，不触发创建。
 * @returns {AudioContext|null}
 */
export function peekGameAudioContext() {
    return getCachedSharedAudioContext(GAME_AUDIO_CONTEXT_KEY);
}

// =================== 主总线 ===================

function applyLimiterParams(compressor) {
    const params = GAME_AUDIO_LIMITER;
    const setParam = (audioParam, value) => {
        if (!audioParam) return;
        if (typeof audioParam.setValueAtTime === 'function') {
            audioParam.setValueAtTime(value, 0);
            return;
        }
        audioParam.value = value;
    };
    setParam(compressor.threshold, params.threshold);
    setParam(compressor.knee, params.knee);
    setParam(compressor.ratio, params.ratio);
    setParam(compressor.attack, params.attack);
    setParam(compressor.release, params.release);
}

/**
 * 幂等：为 ctx 建立 masterGain → Compressor → destination，返回 masterGain。
 * BGM / SFX 总线都应连到这里，而不是 ctx.destination。
 * @param {AudioContext|null} ctx
 * @returns {GainNode|null}
 */
export function ensureGameAudioMaster(ctx = getGameAudioContext()) {
    if (!ctx) return null;

    const existing = masterByContext.get(ctx);
    if (existing?.masterGain) {
        return existing.masterGain;
    }

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    let compressor = null;
    if (GAME_AUDIO_LIMITER.enabled && typeof ctx.createDynamicsCompressor === 'function') {
        try {
            compressor = ctx.createDynamicsCompressor();
            applyLimiterParams(compressor);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 创建限幅器失败，主总线直连输出:`, error);
            compressor = null;
        }
    }

    if (compressor) {
        masterGain.connect(compressor);
        compressor.connect(ctx.destination);
    } else {
        masterGain.connect(ctx.destination);
    }

    masterByContext.set(ctx, { masterGain, compressor });
    return masterGain;
}

/**
 * 读取主总线节点（调试 / 测试用）。
 * @param {AudioContext|null} ctx
 * @returns {{ masterGain: GainNode, compressor: DynamicsCompressorNode|null }|null}
 */
export function getGameAudioMasterNodes(ctx = peekGameAudioContext()) {
    if (!ctx) return null;
    return masterByContext.get(ctx) || null;
}

// =================== 解锁 ===================

function withTimeout(promise, timeoutMs, onTimeout) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return promise;
    }
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(onTimeout());
        }, timeoutMs);
        promise.then(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(null);
            },
        );
    });
}

/**
 * 解锁任意 AudioContext：处理 'suspended' 与 iOS 'interrupted'；'closed' 返回 null。
 * 供仍持有自建 ctx 的旧游戏（阶段 3 前）复用同一套逻辑。
 * @param {AudioContext|null} ctx
 * @param {{ source?: string, timeoutMs?: number }} [options]
 * @returns {Promise<AudioContext|null>}
 */
export function unlockAudioContext(ctx, { source = 'unknown', timeoutMs = DEFAULT_UNLOCK_TIMEOUT_MS } = {}) {
    if (!ctx) {
        return Promise.resolve(null);
    }
    if (ctx.state === 'closed') {
        return Promise.resolve(null);
    }
    if (!RESUMABLE_STATES.has(ctx.state) || typeof ctx.resume !== 'function') {
        return Promise.resolve(ctx);
    }

    let resumePromise;
    try {
        resumePromise = Promise.resolve(ctx.resume()).then(() => ctx);
    } catch (error) {
        console.warn(`${LOG_PREFIX} resume() 抛错 (source=${source}):`, error);
        return Promise.resolve(null);
    }

    return withTimeout(resumePromise, timeoutMs, () => {
        // 超时不代表失败：无手势时 resume() 会一直 pending，调用方按 ctx.state 自行判断。
        return ctx.state === 'running' ? ctx : null;
    });
}

/**
 * 解锁小游戏唯一 ctx。可重复调用；并发调用共享同一个 Promise。
 * 注意：解锁 ctx ≠ 恢复 BGM；恢复 BGM 仍需 manager.startGameplay({ restart: false })。
 * @param {{ source?: string, timeoutMs?: number }} [options]
 * @returns {Promise<AudioContext|null>}
 */
export function unlockGameAudio(options = {}) {
    const ctx = getGameAudioContext();
    if (!ctx) {
        return Promise.resolve(null);
    }
    ensureGameAudioMaster(ctx);

    if (!RESUMABLE_STATES.has(ctx.state)) {
        return Promise.resolve(ctx.state === 'closed' ? null : ctx);
    }

    if (pendingUnlock) {
        return pendingUnlock;
    }

    pendingUnlock = unlockAudioContext(ctx, options).finally(() => {
        pendingUnlock = null;
    });
    return pendingUnlock;
}

/**
 * 幂等安装一次性兜底监听：document pointerdown / touchend / keydown → unlockGameAudio；
 * 页面回到前台再尝试一次（iOS 被打断后 ctx 为 'interrupted'）。
 * @param {{ target?: Document }} [options]
 * @returns {() => void} 卸载函数
 */
export function installGameAudioUnlockListeners({ target = typeof document !== 'undefined' ? document : null } = {}) {
    if (unlockListenersUninstall) {
        return unlockListenersUninstall;
    }
    if (!target || typeof target.addEventListener !== 'function') {
        return () => {};
    }

    const onGesture = (event) => {
        void unlockGameAudio({ source: `gesture:${event?.type || 'unknown'}` });
    };
    const onVisibility = () => {
        if (target.visibilityState && target.visibilityState !== 'visible') return;
        void unlockGameAudio({ source: 'visibilitychange' });
    };

    UNLOCK_EVENTS.forEach((eventName) => {
        target.addEventListener(eventName, onGesture, { passive: true });
    });
    target.addEventListener('visibilitychange', onVisibility);

    unlockListenersUninstall = () => {
        UNLOCK_EVENTS.forEach((eventName) => {
            target.removeEventListener(eventName, onGesture);
        });
        target.removeEventListener('visibilitychange', onVisibility);
        unlockListenersUninstall = null;
    };
    return unlockListenersUninstall;
}

/**
 * 供 getStatus() / 诊断使用的上下文快照。
 * @returns {{ key: string, available: boolean, state: string|null, currentTime: number|null, hasMaster: boolean, limiter: boolean }}
 */
export function getGameAudioContextSnapshot() {
    const ctx = peekGameAudioContext();
    const master = ctx ? masterByContext.get(ctx) : null;
    return {
        key: GAME_AUDIO_CONTEXT_KEY,
        available: Boolean(ctx),
        state: ctx?.state || null,
        currentTime: ctx && Number.isFinite(ctx.currentTime) ? Number(ctx.currentTime.toFixed(3)) : null,
        hasMaster: Boolean(master?.masterGain),
        limiter: Boolean(master?.compressor),
    };
}
