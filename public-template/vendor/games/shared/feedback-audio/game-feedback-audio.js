import { GAME_FEEDBACK_AUDIO_ASSET_IDS, getSharedFeedbackAudioUrl } from '../utils/shared-assets.js';
import { getGameAudioContext, unlockGameAudio } from '../audio/game-audio-context.js';
import { volumeToPerceivedGain } from '../audio/game-audio-prefs.js';
import { GameAudioSettings } from '../audio/game-audio-settings.js';
import { getSharedGameSfxPlayer } from '../audio/game-sfx.js';

/**
 * 共享反馈音兼容 wrapper
 *
 * 导出名与签名保持不变，内部全部转发到 shared/audio/game-sfx.js 的共享 bank，
 * 因此 success / fail / countdownSequence / levelUp / timeUp / timeOut 与游戏音效走同一条总线，
 * 受「音效」开关与 0–100 音量约束。
 *
 * - `{ volume }` 参数视为混音微调 gain（保留一个版本周期），用户音量另走 sfx.volume。
 * - 只在 WebAudio 完全不可用时回退 HTMLAudio；ctx 未解锁时不播（首个手势前不该有音效）。
 *
 * 新代码请直接使用 createGameAudioEngine().sfx.play(id)。
 */

const LOG_PREFIX = '[GameFeedbackAudio]';
const fallbackAudioCache = new Map();
const warnedUnregistered = new Set();

function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(GAME_FEEDBACK_AUDIO_ASSET_IDS, type);
}

function warnUnregistered(type) {
  if (warnedUnregistered.has(type)) return;
  warnedUnregistered.add(type);
  console.warn(`${LOG_PREFIX} 未登记的反馈音类型：${type}（可用：${Object.keys(GAME_FEEDBACK_AUDIO_ASSET_IDS).join(' / ')}）`);
}

function resolveGain({ gain, volume }) {
  const candidate = Number.isFinite(Number(gain)) ? Number(gain) : Number(volume);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : 1;
}

function hasWebAudio() {
  try {
    return Boolean(getGameAudioContext());
  } catch {
    return false;
  }
}

// =================== 无 WebAudio 时的 HTMLAudio 兜底 ===================

function ensureFallbackAudio(type) {
  if (typeof Audio === 'undefined') return null;
  const url = getSharedFeedbackAudioUrl(type);
  if (!url) return null;
  let audio = fallbackAudioCache.get(type);
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.playsInline = true;
    fallbackAudioCache.set(type, audio);
  }
  if (audio.src !== url) {
    audio.src = url;
  }
  return audio;
}

function playFallback(type, { gain, onPlayError, restart }) {
  if (!GameAudioSettings.isEnabled('sfx')) return false;
  const userGain = volumeToPerceivedGain(GameAudioSettings.getVolume('sfx'));
  if (userGain <= 0) return false;
  const template = ensureFallbackAudio(type);
  if (!template) return false;

  const audio = restart ? template : template.cloneNode();
  if (restart) {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // 资源尚未可播时部分浏览器拒绝写 currentTime
    }
  }
  audio.volume = Math.min(1, Math.max(0, userGain * gain));
  audio.playsInline = true;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((error) => {
      if (typeof onPlayError === 'function') onPlayError(error);
    });
  }
  return true;
}

// =================== 公共 API（签名不变） ===================

/**
 * 解锁共享 AudioContext（旧名保留）。返回 Promise<ctx|null>。
 */
export function resumeOneShotAudioContext() {
  return unlockGameAudio({ source: 'feedback-audio' });
}

/**
 * 旧接口：返回该类型的 HTMLAudio 兜底元素（仅无 WebAudio 时有意义）。
 * @deprecated 请改用 sfx.play(type)
 */
export function ensureManagedGameFeedbackAudio(type) {
  if (!isKnownType(type)) {
    warnUnregistered(type);
    return null;
  }
  return hasWebAudio() ? null : ensureFallbackAudio(type);
}

export function preloadGameFeedbackAudio(type) {
  if (!isKnownType(type)) {
    warnUnregistered(type);
    return false;
  }
  void getSharedGameSfxPlayer().preload([type]);
  return true;
}

export function preloadManagedGameFeedbackAudio(type) {
  return preloadGameFeedbackAudio(type);
}

/**
 * @returns {Promise<{ results: Array<{ type, ok, reason? }>, failed: Array }>}
 */
export async function preloadAllGameFeedbackAudio(types = Object.keys(GAME_FEEDBACK_AUDIO_ASSET_IDS)) {
  const list = Array.isArray(types) ? types : Object.keys(GAME_FEEDBACK_AUDIO_ASSET_IDS);
  const known = list.filter((type) => {
    if (isKnownType(type)) return true;
    warnUnregistered(type);
    return false;
  });

  let preloadResult = { loaded: [], failed: [] };
  if (hasWebAudio() && known.length) {
    preloadResult = await getSharedGameSfxPlayer().preload(known);
  }

  const results = list.map((type) => {
    if (!isKnownType(type)) {
      return { type, ok: false, reason: 'unregistered' };
    }
    if (!hasWebAudio()) {
      return { type, ok: Boolean(ensureFallbackAudio(type)), reason: 'html-audio-fallback' };
    }
    const failedItem = preloadResult.failed.find((item) => item.id === type);
    return failedItem
      ? { type, ok: false, error: failedItem.error }
      : { type, ok: preloadResult.loaded.includes(type) };
  });

  return {
    results,
    failed: results.filter((item) => !item.ok && item.reason !== 'unregistered'),
  };
}

export function stopManagedGameFeedbackAudio(type, { reset = true } = {}) {
  if (!isKnownType(type)) return null;
  if (!hasWebAudio()) {
    const audio = fallbackAudioCache.get(type);
    if (audio) {
      audio.pause();
      if (reset) {
        try {
          audio.currentTime = 0;
        } catch {
          // 忽略
        }
      }
    }
    return audio || null;
  }
  getSharedGameSfxPlayer().stop(type);
  return null;
}

/**
 * 管理型播放：单声部、重播打断（对应 sfx 条目 mode: 'restart'）。
 * @returns {boolean} 是否触发播放（禁用 / 未解锁 / 未注册 → false）
 */
export function playManagedGameFeedbackAudio(type, { onPlayError = null, gain, volume } = {}) {
  if (!isKnownType(type)) {
    warnUnregistered(type);
    return false;
  }
  const resolvedGain = resolveGain({ gain, volume });
  if (!hasWebAudio()) {
    return playFallback(type, { gain: resolvedGain, onPlayError, restart: true });
  }
  // restart 模式的 play() 会自己打断旧声部；这里不要先 stop，
  // 否则会取消待补播，并在默认 30ms 节流窗口里把立刻重播静默丢掉。
  return Boolean(getSharedGameSfxPlayer().play(type, { gain: resolvedGain }));
}

/**
 * 一次性播放：可叠播。`volume` 视为混音 gain（兼容旧调用）。
 * @returns {boolean}
 */
export function playGameFeedbackOneShot(type, { volume = 1, gain, onPlayError = null } = {}) {
  if (!isKnownType(type)) {
    warnUnregistered(type);
    return false;
  }
  const resolvedGain = resolveGain({ gain, volume });
  if (!hasWebAudio()) {
    return playFallback(type, { gain: resolvedGain, onPlayError, restart: false });
  }
  return Boolean(getSharedGameSfxPlayer().play(type, { gain: resolvedGain }));
}

const GAME_FEEDBACK_AUDIO_URLS = {};
Object.defineProperties(GAME_FEEDBACK_AUDIO_URLS, Object.fromEntries(
  Object.keys(GAME_FEEDBACK_AUDIO_ASSET_IDS).map((type) => [type, {
    enumerable: true,
    get: () => getSharedFeedbackAudioUrl(type),
  }]),
));
Object.freeze(GAME_FEEDBACK_AUDIO_URLS);

export { GAME_FEEDBACK_AUDIO_URLS };
