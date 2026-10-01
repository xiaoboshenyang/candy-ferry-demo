/**
 * 小游戏音频偏好底层存储（内部模块）
 *
 * 只被 GameAudioSettings 与引擎内部调用；游戏、UI、DevBackdoor 不得直接 import。
 *
 * 存储结构（一份，跨游戏）：
 * { version: 3, bgm: { enabled: true, volume: 100 }, sfx: { enabled: true, volume: 100 }, voice: { enabled: true, volume: 100 } }
 *
 * - volume 为整数 0–100（用户标尺）；真实增益换算见 volumeToPerceivedGain()
 * - 同 document 内通过模块级订阅通知；跨同源 frame 通过浏览器 storage 事件桥接
 * - persist:false 只更新内存（URL 覆盖 / 滑杆拖动中），不写存储
 */

export const GAME_AUDIO_PREFS_STORAGE_KEY = 'silvermind-game-audio-prefs';
export const GAME_AUDIO_PREFS_VERSION = 3;
export const GAME_AUDIO_CHANNELS = Object.freeze(['bgm', 'sfx', 'voice']);
export const GAME_AUDIO_VOLUME_MIN = 0;
export const GAME_AUDIO_VOLUME_MAX = 100;

export const DEFAULT_GAME_AUDIO_CHANNEL_PREFS = Object.freeze({ enabled: true, volume: 100 });

export const DEFAULT_GAME_AUDIO_PREFS = Object.freeze({
    version: GAME_AUDIO_PREFS_VERSION,
    bgm: DEFAULT_GAME_AUDIO_CHANNEL_PREFS,
    sfx: DEFAULT_GAME_AUDIO_CHANNEL_PREFS,
    voice: DEFAULT_GAME_AUDIO_CHANNEL_PREFS,
});

const LOG_PREFIX = '[GameAudioPrefs]';

const listeners = new Set();
// 内存态（含 persist:false 的会话覆盖）；null 表示尚未从存储加载
let memoryPrefs = null;
let storageBridgeInstalled = false;

// =================== 规范化 ===================

/**
 * 把任意输入钳制为整数 0–100；非有限数返回 null。
 * @param {*} value
 * @returns {number|null}
 */
export function clampGameAudioVolume(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    const rounded = Math.round(value);
    return Math.min(GAME_AUDIO_VOLUME_MAX, Math.max(GAME_AUDIO_VOLUME_MIN, rounded));
}

/**
 * 用户音量 0–100 → 听感增益（平方曲线）。0 → 0，50 → 0.25，100 → 1。
 * @param {number} volume
 * @returns {number}
 */
export function volumeToPerceivedGain(volume) {
    const clamped = clampGameAudioVolume(volume);
    if (clamped === null || clamped <= 0) return 0;
    const linear = clamped / GAME_AUDIO_VOLUME_MAX;
    return linear * linear;
}

/**
 * 规范化单个通道。enabled 仅接受 boolean；volume 仅接受有限数值。
 * @param {*} raw
 * @param {{ enabled: boolean, volume: number }} [fallback]
 * @returns {{ enabled: boolean, volume: number }}
 */
export function normalizeGameAudioChannel(raw, fallback = DEFAULT_GAME_AUDIO_CHANNEL_PREFS) {
    const base = {
        enabled: typeof fallback?.enabled === 'boolean' ? fallback.enabled : DEFAULT_GAME_AUDIO_CHANNEL_PREFS.enabled,
        volume: clampGameAudioVolume(fallback?.volume) ?? DEFAULT_GAME_AUDIO_CHANNEL_PREFS.volume,
    };
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    if (typeof raw.enabled === 'boolean') {
        base.enabled = raw.enabled;
    }
    const volume = clampGameAudioVolume(raw.volume);
    if (volume !== null) {
        base.volume = volume;
    }
    return base;
}

/**
 * 纯函数：任意输入 → 合法偏好。损坏 JSON、NaN、字符串、缺通道、未知 version 均安全回退。
 * version 1 按只含 bgm 的旧结构升级；version 2 补 voice 默认开、100。
 * @param {*} raw
 * @returns {{ version: number, bgm: { enabled: boolean, volume: number }, sfx: { enabled: boolean, volume: number }, voice: { enabled: boolean, volume: number } }}
 */
export function normalizeGameAudioPrefs(raw) {
    let input = raw;
    if (typeof input === 'string') {
        try {
            input = JSON.parse(input);
        } catch {
            input = null;
        }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return cloneDefaults();
    }

    const version = Number(input.version);
    if (version === 1) {
        return {
            version: GAME_AUDIO_PREFS_VERSION,
            bgm: normalizeGameAudioChannel(input.bgm),
            sfx: { ...DEFAULT_GAME_AUDIO_CHANNEL_PREFS },
            voice: { ...DEFAULT_GAME_AUDIO_CHANNEL_PREFS },
        };
    }
    if (version === 2) {
        return {
            version: GAME_AUDIO_PREFS_VERSION,
            bgm: normalizeGameAudioChannel(input.bgm),
            sfx: normalizeGameAudioChannel(input.sfx),
            voice: { ...DEFAULT_GAME_AUDIO_CHANNEL_PREFS },
        };
    }
    if (version !== GAME_AUDIO_PREFS_VERSION && input.version !== undefined) {
        return cloneDefaults();
    }

    return {
        version: GAME_AUDIO_PREFS_VERSION,
        bgm: normalizeGameAudioChannel(input.bgm),
        sfx: normalizeGameAudioChannel(input.sfx),
        voice: normalizeGameAudioChannel(input.voice),
    };
}

function cloneDefaults() {
    return clonePrefs(DEFAULT_GAME_AUDIO_PREFS);
}

function clonePrefs(prefs) {
    const next = { version: prefs.version };
    GAME_AUDIO_CHANNELS.forEach((channel) => {
        next[channel] = { ...prefs[channel] };
    });
    return next;
}

/**
 * 只把 patch 里出现的通道字段合并到 base，其它保持不变。
 */
function mergePrefs(base, patch) {
    const next = clonePrefs(base);
    if (!patch || typeof patch !== 'object') {
        return next;
    }
    GAME_AUDIO_CHANNELS.forEach((channel) => {
        const channelPatch = patch[channel];
        if (!channelPatch || typeof channelPatch !== 'object') return;
        next[channel] = normalizeGameAudioChannel(channelPatch, next[channel]);
    });
    return next;
}

/**
 * 计算两份偏好之间真正变化的路径，如 ['bgm.volume', 'sfx.enabled']。
 * @returns {string[]}
 */
export function diffGameAudioPrefs(before, after) {
    const changed = [];
    GAME_AUDIO_CHANNELS.forEach((channel) => {
        ['enabled', 'volume'].forEach((field) => {
            if (before?.[channel]?.[field] !== after?.[channel]?.[field]) {
                changed.push(`${channel}.${field}`);
            }
        });
    });
    return changed;
}

// =================== 存储 ===================

function resolveDefaultStorage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} 无法访问 localStorage，音频偏好只在本次会话内生效:`, error);
    }
    return null;
}

function readFromStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function') {
        return cloneDefaults();
    }
    try {
        return normalizeGameAudioPrefs(storage.getItem(GAME_AUDIO_PREFS_STORAGE_KEY));
    } catch (error) {
        console.warn(`${LOG_PREFIX} 读取音频偏好失败，使用默认值:`, error);
        return cloneDefaults();
    }
}

function writeToStorage(storage, prefs) {
    if (!storage || typeof storage.setItem !== 'function') {
        return false;
    }
    try {
        storage.setItem(GAME_AUDIO_PREFS_STORAGE_KEY, JSON.stringify(prefs));
        return true;
    } catch (error) {
        console.warn(`${LOG_PREFIX} 保存音频偏好失败，本次更改只在会话内生效:`, error);
        return false;
    }
}

function ensureMemoryPrefs(storage) {
    if (!memoryPrefs) {
        memoryPrefs = readFromStorage(storage);
    }
    return memoryPrefs;
}

/**
 * 读取当前偏好（规范化深拷贝）。
 * - 显式传入 storage：纯读该 storage，不碰模块内存（测试 / 宿主镜像用）
 * - 未传：返回模块内存态（首次从 localStorage 加载），包含 persist:false 的会话覆盖
 * @param {{ storage?: Storage|null }} [options]
 */
export function readGameAudioPrefs({ storage } = {}) {
    if (storage !== undefined) {
        return readFromStorage(storage);
    }
    return clonePrefs(ensureMemoryPrefs(resolveDefaultStorage()));
}

/**
 * 深合并 + 规范化 + （可选）持久化 + 通知本 document 全部订阅者。
 * 只有 patch 中的字段进入存储；persist:false 的会话覆盖不会被后续持久化写入带进去。
 * @param {object} patch  { bgm?: { enabled?, volume? }, sfx?: {...}, voice?: {...} }
 * @param {{ storage?: Storage|null, source?: string, persist?: boolean }} [options]
 * @returns {{ prefs: object, changed: string[], persisted: boolean }}
 */
export function writeGameAudioPrefs(patch, { storage, source = 'unknown', persist = true } = {}) {
    const targetStorage = storage === undefined ? resolveDefaultStorage() : storage;
    const before = ensureMemoryPrefs(targetStorage);
    const after = mergePrefs(before, patch);
    const changed = diffGameAudioPrefs(before, after);

    let persisted = false;
    if (persist) {
        // 以存储现值为基底只写 patch，避免把会话覆盖（persist:false）一起落盘。
        // 持久化与否按「存储」是否变化判断，而不是内存：滑杆拖动中 persist:false 已把内存改到位，
        // 松手时的 persist:true 写入即便内存无变化也必须落盘。
        const storedBase = readFromStorage(targetStorage);
        const storedNext = mergePrefs(storedBase, patch);
        if (diffGameAudioPrefs(storedBase, storedNext).length) {
            persisted = writeToStorage(targetStorage, storedNext);
        }
    }

    if (!changed.length) {
        return { prefs: clonePrefs(after), changed, persisted };
    }

    memoryPrefs = after;
    notify(after, { changed, source });
    return { prefs: clonePrefs(after), changed, persisted };
}

/**
 * 重置内存态（下次读取重新从存储加载）。仅测试使用。
 */
export function resetGameAudioPrefsMemory() {
    memoryPrefs = null;
}

// =================== 订阅 ===================

function channelsOf(changed) {
    const set = new Set(changed.map((path) => path.split('.')[0]));
    if (set.size === 0) return 'none';
    if (set.size > 1) return 'all';
    return Array.from(set)[0];
}

function notify(prefs, { changed, source }) {
    if (!listeners.size) return;
    const snapshot = clonePrefs(prefs);
    const meta = { channel: channelsOf(changed), changed: changed.slice(), source };
    Array.from(listeners).forEach((listener) => {
        try {
            listener(clonePrefs(snapshot), meta);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 偏好订阅回调执行失败:`, error);
        }
    });
}

function installStorageBridge() {
    if (storageBridgeInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    storageBridgeInstalled = true;
    window.addEventListener('storage', (event) => {
        if (!event || event.key !== GAME_AUDIO_PREFS_STORAGE_KEY) return;
        const incoming = normalizeGameAudioPrefs(event.newValue);
        const before = ensureMemoryPrefs(resolveDefaultStorage());
        const changed = diffGameAudioPrefs(before, incoming);
        if (!changed.length) return;
        memoryPrefs = incoming;
        notify(incoming, { changed, source: 'storage' });
    });
}

/**
 * 订阅偏好变更。listener(prefs, { channel: 'bgm'|'sfx'|'voice'|'all', changed: string[], source })
 * @param {Function} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeGameAudioPrefs(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    installStorageBridge();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 当前订阅者数量（测试 / 诊断）。
 */
export function getGameAudioPrefsListenerCount() {
    return listeners.size;
}
