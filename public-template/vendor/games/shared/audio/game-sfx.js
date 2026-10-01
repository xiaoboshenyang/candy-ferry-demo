import { ResourceLoader } from '../utils/resource-loader.js';
import { GAME_FEEDBACK_AUDIO_ASSET_IDS } from '../utils/shared-assets.js';
import { SHARED_COMPONENTS_GAME_ID } from '../../resource-manifest.js';
import { ensureGameAudioMaster, getGameAudioContext, rampGainTo, unlockGameAudio } from './game-audio-context.js';
import { clampGameAudioVolume, volumeToPerceivedGain } from './game-audio-prefs.js';
import { GameAudioSettings } from './game-audio-settings.js';

/**
 * 小游戏音效播放器（注册即播）
 *
 * 信号链：
 *   共享 bank 音效 → voiceGain → sfxSharedGain(1)                ┐
 *                                                                ├→ sfxBusGain((volume/100)^2) → masterGain
 *   游戏音效     → voiceGain(条目 gain × play gain) → sfxGameGain(loudnessScale) ┘
 *
 * 条目来源三选一：assetId（manifest，首选）/ url（过渡期）/ synth（合成器，destination 已是 voiceGain）。
 * 只走 WebAudio：ctx 不存在时 play() 返回 null 并只 warn 一次；不回退 HTMLAudio。
 * ctx 尚未 running（手势里 resume 仍是异步）或 buffer 未就绪时：本次返回 null，解锁/加载完成后自动补播一次。
 * 静音即不调度：enabled=false 或 volume=0 时 play() 直接返回 null。
 */

export const SFX_ENTRY_GAIN_MAX = 1.5;
export const SFX_LOUDNESS_SCALE_MAX = 2;
export const SFX_SHARED_BANK_IDS = Object.freeze(Object.keys(GAME_FEEDBACK_AUDIO_ASSET_IDS));

const RAMP_SECONDS = Object.freeze({
    volume: 0.12,
    toggle: 0.25,
    disableStop: 0.1,
});
const DEFAULT_POLY = 4;
const DEFAULT_THROTTLE_MS = 30;
const DEFAULT_SYNTH_DURATION_SEC = 1.5;

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function createWarnLogger(loggerTag) {
    const seen = new Set();
    const warn = (message, error = null) => {
        if (error) {
            console.warn(`${loggerTag} ${message}`, error);
            return;
        }
        console.warn(`${loggerTag} ${message}`);
    };
    warn.once = (key, message, error = null) => {
        if (seen.has(key)) return;
        seen.add(key);
        warn(message, error);
    };
    return warn;
}

export function clampSfxLoudnessScale(value, warn = null) {
    if (value === undefined || value === null) return 1;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        warn?.(`sfx.loudnessScale 非法（${String(value)}），已回退 1`);
        return 1;
    }
    if (numeric > SFX_LOUDNESS_SCALE_MAX) {
        warn?.(`sfx.loudnessScale ${numeric} 超过上限 ${SFX_LOUDNESS_SCALE_MAX}，已钳制`);
        return SFX_LOUDNESS_SCALE_MAX;
    }
    return numeric;
}

function clampEntryGain(value, warn, id) {
    if (value === undefined || value === null) return 1;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        warn?.(`音效 ${id} 的 gain 非法（${String(value)}），已回退 1`);
        return 1;
    }
    if (numeric > SFX_ENTRY_GAIN_MAX) {
        warn?.(`音效 ${id} 的 gain ${numeric} 超过上限 ${SFX_ENTRY_GAIN_MAX}，已钳制；整体偏弱请改 sfx.loudnessScale 或重导素材`);
        return SFX_ENTRY_GAIN_MAX;
    }
    return numeric;
}

function clampPlayGain(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 1;
    return Math.min(SFX_ENTRY_GAIN_MAX, numeric);
}

function decodeArrayBuffer(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
        try {
            const maybePromise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(resolve, reject);
            }
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 默认资源解析：manifest 缓存 → 懒加载 → url fetch+decode。
 */
async function defaultResolveBuffer(entry, { getAudioCtx }) {
    if (entry.assetId) {
        const cached = ResourceLoader.getGameAssetAudioBuffer(entry.gameId, entry.assetId);
        if (cached) return cached;
        const loaded = await ResourceLoader.loadGameAsset(entry.gameId, entry.assetId, { audioBuffer: true });
        if (!loaded?.audioBuffer) {
            throw new Error(`资源 ${entry.gameId}/${entry.assetId} 未能解码为 AudioBuffer（manifest 需声明 decode: 'audio'）`);
        }
        return loaded.audioBuffer;
    }
    if (entry.url) {
        const ctx = getAudioCtx();
        if (!ctx || typeof ctx.decodeAudioData !== 'function') {
            throw new Error('AudioContext 不可用，无法解码 url 音效');
        }
        const response = await fetch(entry.url, { mode: 'cors' });
        if (!response.ok) {
            throw new Error(`下载音效失败：HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return decodeArrayBuffer(ctx, arrayBuffer);
    }
    return null;
}

/**
 * @param {object} options
 * @param {string} options.gameId 默认 assetId 所属游戏
 * @param {number} [options.loudnessScale=1] 游戏级音效整体校准（不影响共享 bank）
 * @param {Record<string, object>} [options.sounds] 音效表 { id: { assetId|url|synth, gain?, poly?, mode?, loop?, throttleMs?, rate?, gameId? } }
 * @param {Function} [options.getAudioCtx] 默认共享 ctx
 * @param {Function} [options.ensureDestination] 默认共享主总线
 * @param {string} [options.loggerTag]
 * @param {boolean} [options.includeSharedBank=true] 自动注册 success/fail/countdownSequence/levelUp/timeUp/timeOut
 * @param {boolean} [options.syncWithSettings=true] 自动订阅 GameAudioSettings（引擎门面自行订阅时传 false）
 * @param {boolean} [options.enabled] 初始开关；默认读 GameAudioSettings
 * @param {number} [options.volume] 初始音量；默认读 GameAudioSettings
 * @param {Function} [options.resolveBuffer] 自定义资源解析（测试注入）
 */
export function createGameSfxPlayer({
    gameId = 'game',
    loudnessScale = 1,
    sounds = {},
    getAudioCtx = getGameAudioContext,
    ensureDestination = ensureGameAudioMaster,
    loggerTag = `[${gameId}:sfx]`,
    includeSharedBank = true,
    syncWithSettings = true,
    enabled,
    volume,
    resolveBuffer = null,
} = {}) {
    const warn = createWarnLogger(loggerTag);
    const entries = new Map();
    const bufferResolver = typeof resolveBuffer === 'function'
        ? resolveBuffer
        : (entry) => defaultResolveBuffer(entry, { getAudioCtx });

    const initialPrefs = { ...GameAudioSettings.getChannel('sfx') };
    if (typeof enabled === 'boolean') initialPrefs.enabled = enabled;
    const initialVolume = clampGameAudioVolume(volume);
    if (initialVolume !== null) initialPrefs.volume = initialVolume;

    const state = {
        enabled: initialPrefs.enabled,
        volume: initialPrefs.volume,
        loudnessScale: clampSfxLoudnessScale(loudnessScale, warn),
        bus: null,
        activeVoices: new Set(),
        unsubscribePrefs: null,
        destroyed: false,
        playRetryGeneration: new Map(),
    };

    // =================== 条目 ===================

    function normalizeEntry(id, raw, { shared = false } = {}) {
        if (!raw || typeof raw !== 'object') {
            throw new Error(`${loggerTag} 音效 ${id} 的声明必须是对象`);
        }
        const hasAsset = typeof raw.assetId === 'string' && raw.assetId;
        const hasUrl = typeof raw.url === 'string' && raw.url;
        const hasSynth = typeof raw.synth === 'function';
        if (!hasAsset && !hasUrl && !hasSynth) {
            throw new Error(`${loggerTag} 音效 ${id} 必须声明 assetId / url / synth 之一`);
        }
        const mode = raw.mode === 'restart' ? 'restart' : 'overlap';
        const polyRaw = Number(raw.poly);
        const poly = mode === 'restart'
            ? 1
            : (Number.isFinite(polyRaw) && polyRaw >= 1 ? Math.floor(polyRaw) : DEFAULT_POLY);
        const throttleRaw = Number(raw.throttleMs);
        const rateRaw = Number(raw.rate);
        return {
            id,
            shared,
            gameId: raw.gameId || (shared ? SHARED_COMPONENTS_GAME_ID : gameId),
            assetId: hasAsset ? raw.assetId : null,
            url: hasUrl ? raw.url : null,
            synth: hasSynth ? raw.synth : null,
            gain: clampEntryGain(raw.gain, warn, id),
            poly,
            mode,
            loop: Boolean(raw.loop),
            throttleMs: Number.isFinite(throttleRaw) && throttleRaw >= 0 ? throttleRaw : DEFAULT_THROTTLE_MS,
            rate: Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1,
            buffer: null,
            loadPromise: null,
            failed: null,
            lastPlayedAt: -Infinity,
            voices: [],
        };
    }

    function register(id, raw, options = {}) {
        if (typeof id !== 'string' || !id) {
            throw new Error(`${loggerTag} 音效 id 必须是非空字符串`);
        }
        const previous = entries.get(id);
        if (previous) {
            stopEntryVoices(previous, { immediate: true });
        }
        const entry = normalizeEntry(id, raw, options);
        entries.set(id, entry);
        return entry;
    }

    if (includeSharedBank) {
        SFX_SHARED_BANK_IDS.forEach((type) => {
            register(type, {
                assetId: GAME_FEEDBACK_AUDIO_ASSET_IDS[type],
                gameId: SHARED_COMPONENTS_GAME_ID,
                mode: type === 'countdownSequence' ? 'restart' : 'overlap',
                // 3-2-1 会 stop 后立刻重播；默认 30ms 节流会把这次重播静默丢掉
                throttleMs: type === 'countdownSequence' ? 0 : DEFAULT_THROTTLE_MS,
            }, { shared: true });
        });
    }

    Object.entries(sounds || {}).forEach(([id, raw]) => {
        register(id, raw);
    });

    // =================== 总线 ===================

    function computeBusGain() {
        return state.enabled ? volumeToPerceivedGain(state.volume) : 0;
    }

    function ensureBus(ctx) {
        if (state.bus && state.bus.ctx === ctx) {
            return state.bus;
        }
        const busGain = ctx.createGain();
        busGain.gain.value = computeBusGain();
        const sharedGain = ctx.createGain();
        sharedGain.gain.value = 1;
        const gameGain = ctx.createGain();
        gameGain.gain.value = state.loudnessScale;
        sharedGain.connect(busGain);
        gameGain.connect(busGain);
        busGain.connect(ensureDestination(ctx) || ctx.destination);
        state.bus = { ctx, busGain, sharedGain, gameGain };
        return state.bus;
    }

    function rampBus(duration) {
        const bus = state.bus;
        if (!bus) return;
        rampGainTo(bus.busGain.gain, computeBusGain(), bus.ctx.currentTime || 0, duration);
    }

    // =================== 资源 ===================

    function ensureBuffer(entry) {
        if (entry.synth) return Promise.resolve(null);
        if (entry.buffer) return Promise.resolve(entry.buffer);
        if (entry.loadPromise) return entry.loadPromise;

        entry.loadPromise = Promise.resolve()
            .then(() => bufferResolver(entry))
            .then((buffer) => {
                if (!buffer) {
                    throw new Error('资源解析返回空');
                }
                entry.buffer = buffer;
                entry.failed = null;
                return buffer;
            })
            .catch((error) => {
                entry.failed = error?.message || String(error);
                warn.once(`load:${entry.id}`, `音效 ${entry.id} 加载失败，将保持静默：`, error);
                return null;
            })
            .finally(() => {
                entry.loadPromise = null;
            });
        return entry.loadPromise;
    }

    async function preload(ids = null) {
        const targets = Array.from(entries.values()).filter((entry) => {
            if (entry.synth) return false;
            if (Array.isArray(ids)) return ids.includes(entry.id);
            return true;
        });
        await Promise.all(targets.map((entry) => ensureBuffer(entry)));
        return {
            loaded: targets.filter((entry) => entry.buffer).map((entry) => entry.id),
            failed: targets.filter((entry) => !entry.buffer).map((entry) => ({ id: entry.id, error: entry.failed })),
        };
    }

    // =================== 声部 ===================

    function finalizeVoice(voice) {
        if (voice.finalized) return;
        voice.finalized = true;
        voice.playing = false;
        if (voice.timer) {
            clearTimeout(voice.timer);
            voice.timer = null;
        }
        const index = voice.entry.voices.indexOf(voice);
        if (index >= 0) voice.entry.voices.splice(index, 1);
        state.activeVoices.delete(voice);
        try {
            voice.voiceGain.disconnect();
        } catch {
            // 节点可能已被 ctx 关闭时释放
        }
    }

    function stopVoice(voice, { fadeOutSec = 0, immediate = false } = {}) {
        if (voice.finalized || voice.stopping) return;
        voice.stopping = true;
        voice.playing = false;
        const ctx = voice.ctx;
        const now = ctx.currentTime || 0;
        const fade = immediate ? 0 : Math.max(0, Number(fadeOutSec) || 0);

        if (fade > 0) {
            rampGainTo(voice.voiceGain.gain, 0, now, fade);
        }

        if (voice.source) {
            try {
                voice.source.stop(now + fade + (fade > 0 ? 0.01 : 0));
            } catch {
                // 尚未 start 或已 stop 时会抛错，忽略
            }
        }
        if (voice.synthController && typeof voice.synthController.stop === 'function') {
            try {
                voice.synthController.stop({ fadeOutSec: fade, immediate });
            } catch (error) {
                warn(`停止合成音效 ${voice.id} 失败：`, error);
            }
        }

        if (fade > 0) {
            voice.timer = setTimeout(() => finalizeVoice(voice), Math.round(fade * 1000) + 40);
        } else {
            finalizeVoice(voice);
        }
    }

    function stopEntryVoices(entry, options) {
        entry.voices.slice().forEach((voice) => stopVoice(voice, options));
    }

    function createHandle(voice) {
        return {
            id: voice.id,
            get playing() {
                return voice.playing && !voice.finalized;
            },
            stop({ fadeOutSec = 0 } = {}) {
                stopVoice(voice, { fadeOutSec });
            },
            setGain(value, rampSec = 0.02) {
                if (voice.finalized) return;
                const target = Math.max(0, voice.entry.gain * clampPlayGain(value));
                rampGainTo(voice.voiceGain.gain, target, voice.ctx.currentTime || 0, rampSec);
            },
        };
    }

    /**
     * @param {string} id
     * @param {{ gain?: number, rate?: number, when?: number, loop?: boolean }} [options]
     * @param {{ fromUnlock?: boolean, fromLoad?: boolean }} [internal]
     * @returns {{ id, playing, stop, setGain }|null}
     */
    function play(id, options = {}, internal = {}) {
        if (state.destroyed) return null;
        const entry = entries.get(id);
        if (!entry) {
            warn.once(`missing:${id}`, `未注册音效：${id}`);
            return null;
        }
        if (!state.enabled || state.volume <= 0) {
            return null;
        }

        const ctx = getAudioCtx();
        if (!ctx) {
            warn.once('no-ctx', 'AudioContext 不可用，音效静默');
            return null;
        }
        if (ctx.state !== 'running') {
            warn.once('locked', `AudioContext 尚未解锁（${ctx.state}），将在解锁后补播`);
            if (!internal.fromUnlock) {
                const generation = (state.playRetryGeneration.get(id) || 0) + 1;
                state.playRetryGeneration.set(id, generation);
                void unlockGameAudio({ source: `${loggerTag}:play` }).then((unlocked) => {
                    if (state.destroyed || state.playRetryGeneration.get(id) !== generation) return;
                    state.playRetryGeneration.delete(id);
                    if (unlocked?.state !== 'running') return;
                    play(id, options, { fromUnlock: true, fromLoad: internal.fromLoad });
                });
            }
            return null;
        }

        const stamp = nowMs();
        // restart（倒计时 stop 后立刻重播）不受节流约束，否则会静默且不报错
        if (entry.mode !== 'restart' && entry.throttleMs > 0 && stamp - entry.lastPlayedAt < entry.throttleMs) {
            return null;
        }

        if (!entry.synth && !entry.buffer) {
            if (!internal.fromLoad) {
                const generation = (state.playRetryGeneration.get(id) || 0) + 1;
                state.playRetryGeneration.set(id, generation);
                void ensureBuffer(entry).then((buffer) => {
                    if (state.destroyed || !buffer || state.playRetryGeneration.get(id) !== generation) return;
                    state.playRetryGeneration.delete(id);
                    play(id, options, { fromUnlock: internal.fromUnlock, fromLoad: true });
                });
            }
            return null;
        }

        entry.lastPlayedAt = stamp;
        const bus = ensureBus(ctx);

        if (entry.mode === 'restart') {
            stopEntryVoices(entry, { immediate: true });
        } else {
            while (entry.voices.length >= entry.poly) {
                stopVoice(entry.voices[0], { immediate: true });
            }
        }

        const playGain = clampPlayGain(options.gain);
        const voiceGainValue = entry.gain * playGain;
        const when = Math.max(0, Number(options.when) || 0);
        const loop = typeof options.loop === 'boolean' ? options.loop : entry.loop;
        const rateRaw = Number(options.rate);
        const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : entry.rate;

        const voiceGain = ctx.createGain();
        voiceGain.gain.value = voiceGainValue;
        voiceGain.connect(entry.shared ? bus.sharedGain : bus.gameGain);

        const voice = {
            id,
            entry,
            ctx,
            voiceGain,
            source: null,
            synthController: null,
            playing: true,
            stopping: false,
            finalized: false,
            timer: null,
        };

        try {
            if (entry.synth) {
                const result = entry.synth({
                    ctx,
                    destination: voiceGain,
                    now: (ctx.currentTime || 0) + when,
                    gain: voiceGainValue,
                    options,
                });
                voice.synthController = result && typeof result === 'object' ? result : null;
                if (!loop) {
                    const durationSec = Number(result?.durationSec);
                    const holdSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DEFAULT_SYNTH_DURATION_SEC;
                    voice.timer = setTimeout(() => finalizeVoice(voice), Math.round((when + holdSec) * 1000) + 50);
                }
            } else {
                const source = ctx.createBufferSource();
                source.buffer = entry.buffer;
                source.loop = loop;
                if (source.playbackRate) {
                    source.playbackRate.value = rate;
                }
                source.connect(voiceGain);
                source.onended = () => finalizeVoice(voice);
                source.start((ctx.currentTime || 0) + when);
                voice.source = source;
            }
        } catch (error) {
            warn(`播放音效 ${id} 失败：`, error);
            finalizeVoice(voice);
            return null;
        }

        entry.voices.push(voice);
        state.activeVoices.add(voice);
        return createHandle(voice);
    }

    function stop(id, { fadeOutSec = 0 } = {}) {
        state.playRetryGeneration.delete(id);
        const entry = entries.get(id);
        if (!entry) return false;
        const had = entry.voices.length > 0;
        stopEntryVoices(entry, { fadeOutSec });
        return had;
    }

    function stopAll({ fadeOutSec = 0 } = {}) {
        state.playRetryGeneration.clear();
        Array.from(state.activeVoices).forEach((voice) => stopVoice(voice, { fadeOutSec }));
    }

    // =================== 偏好 ===================

    function setVolume(nextVolume) {
        const clamped = clampGameAudioVolume(typeof nextVolume === 'string' ? Number(nextVolume) : nextVolume);
        if (clamped === null) {
            warn(`setVolume 需要 0–100 的数值，已忽略：${String(nextVolume)}`);
            return getStatus();
        }
        if (clamped === state.volume) return getStatus();
        state.volume = clamped;
        rampBus(RAMP_SECONDS.volume);
        if (clamped === 0) {
            stopAll({ fadeOutSec: RAMP_SECONDS.disableStop });
        }
        return getStatus();
    }

    function setEnabled(nextEnabled) {
        const value = Boolean(nextEnabled);
        if (value === state.enabled) return getStatus();
        state.enabled = value;
        rampBus(RAMP_SECONDS.toggle);
        if (!value) {
            // 循环音效在关闭时停止；重新打开不自动恢复，由游戏按状态重新 play()
            stopAll({ fadeOutSec: RAMP_SECONDS.disableStop });
        }
        return getStatus();
    }

    function applyPrefs(prefs = {}) {
        if (!prefs || typeof prefs !== 'object') return getStatus();
        if (clampGameAudioVolume(prefs.volume) !== null) setVolume(prefs.volume);
        if (typeof prefs.enabled === 'boolean') setEnabled(prefs.enabled);
        return getStatus();
    }

    if (syncWithSettings) {
        state.unsubscribePrefs = GameAudioSettings.subscribe(({ prefs, changed }) => {
            if (!changed.some((path) => path.startsWith('sfx.'))) return;
            applyPrefs(prefs.sfx);
        });
    }

    // =================== 状态 ===================

    function getStatus() {
        const list = Array.from(entries.values());
        return {
            available: true,
            gameId,
            enabled: state.enabled,
            volume: state.volume,
            masterVolume: state.volume / 100,
            loudnessScale: state.loudnessScale,
            busGain: computeBusGain(),
            currentBusGain: Number.isFinite(state.bus?.busGain?.gain?.value) ? state.bus.busGain.gain.value : 0,
            gameGain: state.loudnessScale,
            activeVoices: state.activeVoices.size,
            registered: list.map((entry) => entry.id),
            preloaded: list.filter((entry) => entry.buffer).map((entry) => entry.id),
            failed: list.filter((entry) => entry.failed).map((entry) => ({ id: entry.id, error: entry.failed })),
        };
    }

    return {
        play,
        stop,
        stopAll,
        preload,
        register(id, raw) {
            register(id, raw);
            return this;
        },
        unregister(id) {
            const entry = entries.get(id);
            if (!entry) return false;
            stopEntryVoices(entry, { immediate: true });
            entries.delete(id);
            return true;
        },
        has(id) {
            return entries.has(id);
        },
        list() {
            return Array.from(entries.keys());
        },
        isReady(id) {
            const entry = entries.get(id);
            return Boolean(entry && (entry.synth || entry.buffer));
        },
        getEnabled() {
            return state.enabled;
        },
        setEnabled,
        getVolume() {
            return state.volume;
        },
        setVolume,
        getMasterVolume() {
            return state.volume / 100;
        },
        getLoudnessScale() {
            return state.loudnessScale;
        },
        applyPrefs,
        getStatus,
        destroy() {
            if (state.destroyed) return;
            state.destroyed = true;
            if (state.unsubscribePrefs) {
                state.unsubscribePrefs();
                state.unsubscribePrefs = null;
            }
            stopAll({ fadeOutSec: 0 });
            if (state.bus) {
                ['sharedGain', 'gameGain', 'busGain'].forEach((key) => {
                    try {
                        state.bus[key].disconnect();
                    } catch {
                        // ctx 可能已关闭
                    }
                });
                state.bus = null;
            }
            // 不释放 AudioBuffer：由 ResourceLoader 的 releaseGameMemory 统一管理
            entries.clear();
        },
    };
}

// =================== 模块级共享 player（feedback-audio wrapper / level-up 使用） ===================

let sharedSfxPlayer = null;

/**
 * 共享反馈音 player：只含共享 bank，无游戏条目；跟随 GameAudioSettings。
 * 游戏自己的音效请用 createGameAudioEngine / createGameSfxPlayer。
 */
export function getSharedGameSfxPlayer() {
    if (!sharedSfxPlayer) {
        sharedSfxPlayer = createGameSfxPlayer({
            gameId: SHARED_COMPONENTS_GAME_ID,
            loggerTag: '[GameSfx:shared]',
            includeSharedBank: true,
            syncWithSettings: true,
        });
    }
    return sharedSfxPlayer;
}
