import { RuntimeEnvironment } from '../../../core/runtime-environment.js';
import {
    DEFAULT_GAME_AUDIO_CHANNEL_PREFS,
    GAME_AUDIO_CHANNELS,
    GAME_AUDIO_VOLUME_MAX,
    GAME_AUDIO_VOLUME_MIN,
    clampGameAudioVolume,
    normalizeGameAudioPrefs,
    readGameAudioPrefs,
    subscribeGameAudioPrefs,
    volumeToPerceivedGain,
    writeGameAudioPrefs,
} from './game-audio-prefs.js';

/**
 * 小游戏音频公共设置接口（唯一写入口）
 *
 * 测试面板、产品设置页、DevBackdoor、宿主消息、URL 覆盖全部经此读写；
 * 游戏 / UI 不得直接调用 bgm.setVolume() / sfx.setEnabled() 或读写 localStorage。
 *
 * source ∈ { 'ui', 'dev', 'host', 'url', 'storage', 'unknown' }，透传给订阅者便于排查「谁改了音量」。
 */

export { GAME_AUDIO_CHANNELS };

export const GAME_AUDIO_SOURCES = Object.freeze(['ui', 'dev', 'host', 'url', 'storage', 'unknown']);

const LOG_PREFIX = '[GameAudioSettings]';

/** 设置面板 UI 文案，只用于显示，不进入 Text2Audio 目录。 */
const CHANNEL_DESCRIPTIONS = Object.freeze({
    bgm: Object.freeze({
        label: '背景音乐',
        volumeLabel: '背景音乐音量',
        previewLabel: '试听',
        stopPreviewLabel: '停止试听',
        disabledHint: '背景音乐已关闭',
    }),
    sfx: Object.freeze({
        label: '音效',
        volumeLabel: '音效音量',
        previewLabel: '试听',
        stopPreviewLabel: '试听',
        disabledHint: '音效已关闭',
    }),
    voice: Object.freeze({
        label: '语音',
        volumeLabel: '语音音量',
        previewLabel: '试听',
        stopPreviewLabel: '试听',
        disabledHint: '语音已关闭',
    }),
});

const URL_PARAM_MAP = Object.freeze({
    bgm: Object.freeze({ enabled: 'bgm', volume: 'bgmVolume' }),
    sfx: Object.freeze({ enabled: 'sfx', volume: 'sfxVolume' }),
    voice: Object.freeze({ enabled: 'voice', volume: 'voiceVolume' }),
});

function assertChannel(channel) {
    if (!GAME_AUDIO_CHANNELS.includes(channel)) {
        throw new Error(`${LOG_PREFIX} 未知音频通道：${String(channel)}`);
    }
    return channel;
}

function normalizeSource(source) {
    return GAME_AUDIO_SOURCES.includes(source) ? source : 'unknown';
}

function toPublicPrefs(prefs) {
    const publicPrefs = {};
    GAME_AUDIO_CHANNELS.forEach((channel) => {
        publicPrefs[channel] = { ...prefs[channel] };
    });
    return publicPrefs;
}

function parseBooleanParam(value) {
    if (value === null || value === undefined) return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
    return undefined;
}

function parseVolumeParam(value) {
    if (value === null || value === undefined || String(value).trim() === '') return undefined;
    const numeric = Number(value);
    const clamped = clampGameAudioVolume(numeric);
    return clamped === null ? undefined : clamped;
}

function toSearchParams(input) {
    if (input instanceof URLSearchParams) return input;
    if (typeof input === 'string') return new URLSearchParams(input);
    if (typeof location !== 'undefined' && typeof location.search === 'string') {
        return new URLSearchParams(location.search);
    }
    return new URLSearchParams('');
}

function defaultUrlOverrideEnabled() {
    return RuntimeEnvironment.capabilities.runtimeOverrides;
}

function createDefaultPublicPrefs() {
    const prefs = {};
    GAME_AUDIO_CHANNELS.forEach((channel) => {
        prefs[channel] = DEFAULT_GAME_AUDIO_CHANNEL_PREFS;
    });
    return Object.freeze(prefs);
}

/**
 * 根据语音通道偏好决定是否播放，以及扬声器增益。
 * 关闭或音量为 0 时不播放；增益走平方曲线，与 BGM / 音效一致。
 * @param {{ enabled?: boolean, volume?: number }} [channelPrefs]
 * @returns {{ playable: boolean, reason: string|null, playbackVolume: number }}
 */
export function resolveGameVoicePlayback(channelPrefs) {
    const voice = channelPrefs && typeof channelPrefs === 'object'
        ? channelPrefs
        : GameAudioSettings.get().voice;
    const enabled = voice.enabled !== false;
    const volume = Number.isFinite(Number(voice.volume)) ? Number(voice.volume) : 100;
    if (!enabled) {
        return { playable: false, reason: 'game-voice-disabled', playbackVolume: 0 };
    }
    if (!(volume > 0)) {
        return { playable: false, reason: 'game-voice-muted', playbackVolume: 0 };
    }
    return {
        playable: true,
        reason: null,
        playbackVolume: volumeToPerceivedGain(volume),
    };
}

export const GameAudioSettings = {
    DEFAULTS: createDefaultPublicPrefs(),
    VOLUME_MIN: GAME_AUDIO_VOLUME_MIN,
    VOLUME_MAX: GAME_AUDIO_VOLUME_MAX,
    /** 产品 UI 步进；测试面板可用 1 */
    VOLUME_STEP: 5,
    CHANNELS: GAME_AUDIO_CHANNELS,
    SOURCES: GAME_AUDIO_SOURCES,

    /**
     * @returns {{ bgm: { enabled, volume }, sfx: { enabled, volume }, voice: { enabled, volume } }} 规范化深拷贝
     */
    get() {
        return toPublicPrefs(readGameAudioPrefs());
    },

    getChannel(channel) {
        assertChannel(channel);
        return { ...readGameAudioPrefs()[channel] };
    },

    isEnabled(channel) {
        return this.getChannel(channel).enabled;
    },

    getVolume(channel) {
        return this.getChannel(channel).volume;
    },

    /**
     * @param {'bgm'|'sfx'|'voice'} channel
     * @param {boolean} enabled
     * @param {{ source?: string, persist?: boolean }} [options]
     */
    setEnabled(channel, enabled, { source = 'unknown', persist = true } = {}) {
        assertChannel(channel);
        if (typeof enabled !== 'boolean') {
            console.warn(`${LOG_PREFIX} setEnabled 需要 boolean，已忽略：`, enabled);
            return this.getChannel(channel).enabled;
        }
        return this.update({ [channel]: { enabled } }, { source, persist })[channel].enabled;
    },

    /**
     * 非有限数 → 忽略并 warn；否则 round + clamp 到 0–100。
     * @param {'bgm'|'sfx'|'voice'} channel
     * @param {number} value
     * @param {{ source?: string, persist?: boolean }} [options]
     */
    setVolume(channel, value, { source = 'unknown', persist = true } = {}) {
        assertChannel(channel);
        const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        const clamped = clampGameAudioVolume(numeric);
        if (clamped === null) {
            console.warn(`${LOG_PREFIX} setVolume 需要 0–100 的数值，已忽略：`, value);
            return this.getChannel(channel).volume;
        }
        return this.update({ [channel]: { volume: clamped } }, { source, persist })[channel].volume;
    },

    toggle(channel, { source = 'unknown', persist = true } = {}) {
        assertChannel(channel);
        const next = !this.getChannel(channel).enabled;
        this.update({ [channel]: { enabled: next } }, { source, persist });
        return next;
    },

    /**
     * 批量更新。persist:false 只更新内存并通知订阅者（URL 覆盖 / 拖动中的滑杆）。
     * @param {{ bgm?: { enabled?, volume? }, sfx?: { enabled?, volume? }, voice?: { enabled?, volume? } }} patch
     * @param {{ source?: string, persist?: boolean }} [options]
     * @returns {{ bgm, sfx, voice }} 更新后的偏好
     */
    update(patch, { source = 'unknown', persist = true } = {}) {
        const safePatch = {};
        if (patch && typeof patch === 'object') {
            GAME_AUDIO_CHANNELS.forEach((channel) => {
                const channelPatch = patch[channel];
                if (!channelPatch || typeof channelPatch !== 'object') return;
                const entry = {};
                if (typeof channelPatch.enabled === 'boolean') {
                    entry.enabled = channelPatch.enabled;
                }
                const volume = clampGameAudioVolume(
                    typeof channelPatch.volume === 'string' ? Number(channelPatch.volume) : channelPatch.volume,
                );
                if (volume !== null) {
                    entry.volume = volume;
                }
                if (Object.keys(entry).length) {
                    safePatch[channel] = entry;
                }
            });
        }
        const result = writeGameAudioPrefs(safePatch, { source: normalizeSource(source), persist });
        return toPublicPrefs(result.prefs);
    },

    reset({ source = 'unknown', persist = true } = {}) {
        const patch = {};
        GAME_AUDIO_CHANNELS.forEach((channel) => {
            patch[channel] = { ...DEFAULT_GAME_AUDIO_CHANNEL_PREFS };
        });
        return this.update(patch, { source, persist });
    },

    /**
     * listener({ prefs, changed: ['bgm.volume', ...], channel, source })
     * @param {Function} listener
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        return subscribeGameAudioPrefs((prefs, meta) => {
            listener({
                prefs: toPublicPrefs(prefs),
                changed: meta.changed,
                channel: meta.channel,
                source: meta.source,
            });
        });
    },

    /**
     * URL 覆盖（仅 dev / testMode）：?bgm=0|1&bgmVolume=0..100&sfx=0|1&sfxVolume=0..100&voice=0|1&voiceVolume=0..100
     * 以 persist:false 写入，刷新即失效。
     * @param {string|URLSearchParams} [params]
     * @param {{ enabled?: boolean }} [options]
     * @returns {{ applied: boolean, patch: object }}
     */
    applyUrlOverrides(params = undefined, { enabled } = {}) {
        const searchParams = toSearchParams(params);
        const allow = typeof enabled === 'boolean' ? enabled : defaultUrlOverrideEnabled();
        const patch = {};

        GAME_AUDIO_CHANNELS.forEach((channel) => {
            const map = URL_PARAM_MAP[channel];
            const enabledValue = parseBooleanParam(searchParams.get(map.enabled));
            const volumeValue = parseVolumeParam(searchParams.get(map.volume));
            const entry = {};
            if (enabledValue !== undefined) entry.enabled = enabledValue;
            if (volumeValue !== undefined) entry.volume = volumeValue;
            if (Object.keys(entry).length) patch[channel] = entry;
        });

        if (!allow || !Object.keys(patch).length) {
            return { applied: false, patch };
        }

        this.update(patch, { source: 'url', persist: false });
        return { applied: true, patch };
    },

    /**
     * 宿主消息 / 外部输入先经此规范化，再 update()。
     */
    normalize(raw) {
        return toPublicPrefs(normalizeGameAudioPrefs(raw));
    },

    /**
     * 文案：{ bgm: { label: '背景音乐', ... }, sfx: { label: '音效', ... }, voice: { label: '语音', ... } }
     */
    describe() {
        const descriptions = {};
        GAME_AUDIO_CHANNELS.forEach((channel) => {
            descriptions[channel] = { ...CHANNEL_DESCRIPTIONS[channel] };
        });
        return descriptions;
    },

    resolveVoicePlayback(channelPrefs) {
        return resolveGameVoicePlayback(channelPrefs ?? this.get().voice);
    },
};
