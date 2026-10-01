/**
 * GamePostMessage — 游戏 iframe ↔ 父页面 postMessage 统一协议工具
 *
 * 全权负责所有游戏 → 父页面的 postMessage 发送：
 * - 生命周期消息：gameLoaded / gameStarted / gameFinished / gameDisplayReady
 * - 运行时消息：配置下发、训练积分、游戏状态查询、续玩、音频偏好
 *
 * GameBase 内部通过本模块发送生命周期消息，不再自行 postMessage。
 *
 * 用法一（推荐）：listen / unlisten 完整托管
 * ```js
 * import { GamePostMessage } from '../../shared/game-post-message.js';
 * GamePostMessage.listen({
 *     onGetGameStats: () => ({ score, difficulty }),
 *     onGameContinue: (action) => { ... },
 * });
 * // 销毁时
 * GamePostMessage.unlisten();
 * ```
 *
 * 用法二：在已有 handleParentMessage 中调用单条处理
 * ```js
 * import { handleStandardParentMessage, showTrainingPoints } from '../../shared/game-post-message.js';
 * function handleParentMessage(event) {
 *     if (handleStandardParentMessage(event.data, handlers)) return;
 *     // 游戏专有消息
 * }
 * ```
 */

import { GAME_AUDIO_CHANNELS, GameAudioSettings } from '../audio/game-audio-settings.js';
import { RuntimeEnvironment } from '../../../core/runtime-environment.js';

// =================== 内部状态 ===================

let _boundListener = null;
let _handlers = {};
let _lastTrainingPointsResponse = null;
let _audioPrefsUnsub = null;
let _hostAudioPrefsListener = null;

// 生命周期幂等标志
let _loadedNotified = false;
let _startedNotified = false;
let _displayReadyNotified = false;

// =================== 工具方法 ===================

export function postToParent(payload) {
  if (typeof window.parent?.postMessage === 'function') {
    window.parent.postMessage(payload, '*');
  }
}

// =================== 生命周期出站消息 ===================

/**
 * 通知父页面游戏资源加载完成（幂等，仅首次生效）
 */
export function notifyGameLoaded() {
  if (_loadedNotified) return false;
  postToParent({ type: 'gameLoaded' });
  _loadedNotified = true;
  return true;
}

/**
 * 通知父页面游戏正式开始（幂等，仅首次生效）
 */
export function notifyGameStarted() {
  if (_startedNotified) return false;
  postToParent({ type: 'gameStarted' });
  _startedNotified = true;
  return true;
}

/**
 * 通知父页面游戏首屏已就绪（幂等，仅首次生效）
 * @param {Object} [data] — 附加数据，如 { screen: 'intro' }
 */
export function notifyGameDisplayReady(data = {}) {
  if (_displayReadyNotified) return false;
  postToParent({ type: 'gameDisplayReady', data });
  _displayReadyNotified = true;
  return true;
}

/**
 * 通知父页面游戏结束，并重置 started / displayReady 标志
 * 在 dev testMode 下，跳过 postMessage 以避免上报结算数据
 * @param {Object} [data] — 游戏结果数据
 * @returns {boolean} 是否实际发送了 postMessage
 */
export function notifyGameFinished(data = {}) {
  // 小伴使用记录由页面级适配器提供；旧游戏不注册 provider 时保持原结果格式。
  const guidanceUsage = typeof window.__xiaobanGuidanceUsageProvider === 'function'
    ? window.__xiaobanGuidanceUsageProvider()
    : null;
  if (guidanceUsage && !data.guidanceUsage) {
    data = { ...data, guidanceUsage };
  }
  const testMode = window.__devTestMode;
  const shouldSuppressResult = RuntimeEnvironment.capabilities.suppressResultReporting
    || (testMode?.active && testMode.skipResult);
  if (shouldSuppressResult) {
    console.log('[DEV] testMode 已激活，跳过 notifyGameFinished postMessage');
    _startedNotified = false;
    _displayReadyNotified = false;
    return false;
  }
  postToParent({ type: 'gameFinished', data });
  _startedNotified = false;
  _displayReadyNotified = false;
  return true;
}

/**
 * 重置所有生命周期幂等标志（供 GameBase.init 调用）
 */
export function resetLifecycleFlags() {
  _loadedNotified = false;
  _startedNotified = false;
  _displayReadyNotified = false;
}

/**
 * 查询当前生命周期标志状态
 */
export function getLifecycleFlags() {
  return {
    loadedNotified: _loadedNotified,
    startedNotified: _startedNotified,
    displayReadyNotified: _displayReadyNotified,
  };
}

// =================== 运行时出站消息 ===================

/**
 * 请求父页面返回指定游戏的持久化数据（如最高分）
 * 父页面以 gameDataResponse 回复
 * @param {string} gameSlug — 游戏 slug（文件夹名）
 * @param {string} [requestId] — 请求标识，宿主将在响应中原样返回
 */
export function requestGameData(gameSlug, requestId = '') {
  postToParent({
    type: 'requestGameData',
    gameSlug,
    ...(requestId ? { requestId } : {}),
  });
}

/**
 * 请求父页面返回当前总训练积分
 * 父页面以 totalTrainingPointsResponse 回复
 */
export function requestTotalTrainingPoints() {
  postToParent({ type: 'getTotalTrainingPoints' });
}

/**
 * 通知父页面展示训练积分获得动画
 * @param {number} points — 本次获得的积分数
 */
export function showTrainingPoints(points) {
  postToParent({ type: 'showTrainingPoints', points });
}

/**
 * 主动向父页面发送游戏状态（响应 getGameStats）
 * @param {Object} data — { score, difficulty, ... }
 */
export function sendGameStats(data) {
  postToParent({ type: 'gameStats', data });
}

// =================== 入站消息处理 ===================

/**
 * 尝试处理标准协议消息，返回 true 表示已处理
 *
 * 可在已有 handleParentMessage 中调用，与游戏专有消息共存。
 *
 * @param {Object} data — event.data
 * @param {Object} handlers — 消息回调集合
 * @param {Function} [handlers.onSetGameConfig] — (configData) => void
 * @param {Function} [handlers.onGetGameStats] — () => statsObject | null
 * @param {Function} [handlers.onGameContinue] — (action, fullData) => void
 * @param {Function} [handlers.onTrainingPointsResponse] — (data) => void
 * @param {Function} [handlers.onTotalTrainingPointsResponse] — (data) => void
 * @param {Function} [handlers.onSetGameAudioPrefs] — (prefs, rawData) => void
 * @returns {boolean} 是否命中标准协议消息
 */
export function handleStandardParentMessage(data, handlers = {}) {
  if (!data || !data.type) return false;

  switch (data.type) {
    case 'setGameConfig':
      handlers.onSetGameConfig?.(data);
      return true;

    case 'gameAudioPrefs':
      applyHostGameAudioPrefs(data, handlers);
      return true;

    case 'getGameStats':
      if (typeof handlers.onGetGameStats === 'function') {
        const stats = handlers.onGetGameStats();
        if (stats) {
          sendGameStats(stats);
        }
      }
      return true;

    case 'gameContinue':
      handlers.onGameContinue?.(data.action, data);
      return true;

    case 'trainingPointsResponse':
      _lastTrainingPointsResponse = {
        totalPoints: data.totalPoints,
        addedPoints: data.addedPoints,
      };
      handlers.onTrainingPointsResponse?.(data);
      return true;

    case 'totalTrainingPointsResponse':
      _lastTrainingPointsResponse = {
        total: data.total,
        dailyTotal: data.dailyTotal,
        lastUpdateDate: data.lastUpdateDate,
      };
      handlers.onTotalTrainingPointsResponse?.(data);
      return true;

    case 'gameDataResponse':
      handlers.onGameDataResponse?.(data);
      return true;

    default:
      return false;
  }
}

function notifyHostAudioPrefsChanged(source) {
  postToParent({
    type: 'gameAudioPrefsChanged',
    prefs: GameAudioSettings.get(),
    source,
  });
}

/**
 * 宿主下发音频偏好。只更新消息里出现的通道，避免把未给出的通道重置成默认值。
 * 同一条消息可能被 GamePostMessage.listen 与门面直装监听各处理一次，无变化时不重复回传。
 */
function applyHostGameAudioPrefs(data, handlers = {}) {
  const persist = data?.persist !== false;
  const patch = {};
  GAME_AUDIO_CHANNELS.forEach((channel) => {
    if (data?.[channel] != null) {
      patch[channel] = GameAudioSettings.normalize({ [channel]: data[channel] })[channel];
    }
  });
  const before = GameAudioSettings.get();
  const prefs = Object.keys(patch).length
    ? GameAudioSettings.update(patch, { source: 'host', persist })
    : before;
  handlers.onSetGameAudioPrefs?.(prefs, data);
  const changed = GAME_AUDIO_CHANNELS.some((channel) => (
    before[channel].enabled !== prefs[channel].enabled
    || before[channel].volume !== prefs[channel].volume
  ));
  if (changed) {
    notifyHostAudioPrefsChanged('host');
  }
}

function subscribeHostAudioPrefsMirror() {
  if (_audioPrefsUnsub) return;
  _audioPrefsUnsub = GameAudioSettings.subscribe(({ prefs, source }) => {
    if (source === 'host') return;
    postToParent({
      type: 'gameAudioPrefsChanged',
      prefs,
      source,
    });
  });
}

/**
 * 把游戏内音频偏好变更镜像给宿主。iframe 里语音在父窗口播放，滑杆拖动必须立刻通知宿主改当前句增益。
 * createGameAudioEngine 不订阅此镜像（以免门面 listener 计数被带偏）；gameVoice 与 GamePostMessage.listen 会幂等安装。
 */
export function installGameAudioPrefsHostMirror() {
  subscribeHostAudioPrefsMirror();
}

/**
 * 幂等安装宿主音频偏好入站监听。不依赖游戏是否调用 GamePostMessage.listen。
 * createGameAudioEngine 会调用，保证已迁移游戏都能收到 `{ type: 'gameAudioPrefs' }`。
 */
export function installGameAudioHostPrefsListener() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  if (_hostAudioPrefsListener) return;
  _hostAudioPrefsListener = (event) => {
    if (event?.data?.type !== 'gameAudioPrefs') return;
    applyHostGameAudioPrefs(event.data);
  };
  window.addEventListener('message', _hostAudioPrefsListener);
}

// =================== 完整监听管理 ===================

function _onMessage(event) {
  const data = event.data;
  if (!data || !data.type) return;

  if (handleStandardParentMessage(data, _handlers)) return;

  // 未命中标准消息 → 透传给自定义兜底
  _handlers.onUnhandled?.(data, event);
}

/**
 * GamePostMessage — 统一 postMessage 协议管理器
 *
 * 出站：requestTotalTrainingPoints / showTrainingPoints / sendGameStats
 *       （也可直接 import 上方命名导出单独使用）
 * 入站：listen(handlers) 注册标准消息监听
 */
export const GamePostMessage = {
  /**
   * 注册标准消息监听
   *
   * @param {Object} handlers
   * @param {Function} [handlers.onSetGameConfig]               — 父页面下发配置
   * @param {Function} [handlers.onGetGameStats]                — 父页面拉取状态，返回数据对象
   * @param {Function} [handlers.onGameContinue]                — 续玩指令 (action, data)
   * @param {Function} [handlers.onTrainingPointsResponse]      — 积分动画回执
   * @param {Function} [handlers.onTotalTrainingPointsResponse] — 总积分查询回执
   * @param {Function} [handlers.onGameDataResponse]             — 游戏数据查询回执 (data)
   * @param {Function} [handlers.onSetGameAudioPrefs]            — 宿主下发音频偏好 (prefs, rawData)
   * @param {Function} [handlers.onUnhandled]                   — 未匹配消息兜底 (data, event)
   */
  listen(handlers = {}) {
    this.unlisten();
    _handlers = handlers;
    _boundListener = _onMessage;
    window.addEventListener('message', _boundListener);
    installGameAudioHostPrefsListener();
    subscribeHostAudioPrefsMirror();
  },

  /** 移除监听器并清理状态 */
  unlisten() {
    if (_boundListener) {
      window.removeEventListener('message', _boundListener);
      _boundListener = null;
    }
    _handlers = {};
  },

  // 生命周期出站
  notifyGameLoaded,
  notifyGameStarted,
  notifyGameDisplayReady,
  notifyGameFinished,
  resetLifecycleFlags,
  getLifecycleFlags,

  // 运行时出站
  requestGameData,
  requestTotalTrainingPoints,
  showTrainingPoints,
  sendGameStats,
  postToParent,

  /** 获取最近一次积分响应缓存 */
  getLastTrainingPointsResponse() {
    return _lastTrainingPointsResponse;
  },
};
