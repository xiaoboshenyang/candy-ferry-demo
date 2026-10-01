/**
 * 游戏顶部信息栏 — 通用组件 JS
 *
 * 提供 HTML 模板生成、DOM 引用获取、以及运行时更新工具函数。
 * 配合 game-top-bar.css 使用。
 *
 * 用法：
 *   import { createTopBarHTML, getTopBarRefs, updateTimer, updateScore, updateLevel } from '../shared/top-bar/game-top-bar.js';
 */

import { getSharedAssetUrl, SHARED_ASSET_IDS } from '../utils/shared-assets.js';

// =================== 共享图标资源 ===================
const ICON_LEVEL_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sm-level-bg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F8D17A"/>
      <stop offset="1" stop-color="#D6872F"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="48" height="48" rx="12" fill="url(#sm-level-bg)" stroke="#8D4A16" stroke-width="3"/>
  <rect x="17" y="33" width="7" height="14" rx="2.5" fill="white" fill-opacity="0.96"/>
  <rect x="28.5" y="25" width="7" height="22" rx="2.5" fill="white" fill-opacity="0.96"/>
  <rect x="40" y="17" width="7" height="30" rx="2.5" fill="#FFF0C2"/>
  <path d="M14 52.5H50" stroke="#8D4A16" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
</svg>
`.trim();

function buildSharedIconHtml(assetId, alt, fallbackHtml = '') {
    const iconUrl = getSharedAssetUrl(assetId);
    if (!iconUrl) {
        return fallbackHtml;
    }
    return `<img src="${iconUrl}" alt="${alt}">`;
}

// =================== HTML 生成 ===================

/**
 * 生成顶部信息栏 HTML
 * @param {Object} [config]
 * @param {string} [config.pauseText='暂停/帮助'] - 暂停按钮文案
 * @param {string} [config.timerIcon] - 计时图标 HTML（img 标签或 emoji），默认使用共享图标
 * @param {string} [config.levelIcon] - 难度图标 HTML，默认使用共享图标
 * @param {string} [config.scoreIcon] - 得分图标 HTML，默认使用共享图标
 * @param {string} [config.defaultTime='02:00'] - 默认计时显示
 * @param {string} [config.defaultLevel='初级'] - 默认等级显示
 * @param {boolean} [config.levelNotice=false] - 是否包含等级变化通知条
 * @returns {string} HTML 字符串
 */
export function createTopBarHTML(config = {}) {
    const defaultTimerIcon = buildSharedIconHtml(SHARED_ASSET_IDS.iconTimer, '计时');
    const defaultLevelIcon = buildSharedIconHtml(SHARED_ASSET_IDS.iconLevel, '难度', ICON_LEVEL_SVG);
    const defaultScoreIcon = buildSharedIconHtml(SHARED_ASSET_IDS.iconScore, '得分');
    const {
        pauseText = '暂停/帮助',
        timerIcon = defaultTimerIcon,
        levelIcon = defaultLevelIcon,
        scoreIcon = defaultScoreIcon,
        defaultTime = '02:00',
        defaultLevel = '初级',
        levelNotice = false,
    } = config;

    let html = `
    <div class="top-bar">
        <button class="pause-btn" id="btnPause" data-testid="pause-btn">${pauseText}</button>
        <div class="top-bar-statuses">
            <div class="info-group info-group--timer">
                <span class="info-icon info-icon--timer">${timerIcon}</span>
                <span class="info-label">时间：</span>
                <span class="info-value timer-value" id="timerDisplay" data-testid="timer">${defaultTime}</span>
            </div>
            <div class="info-group info-group--level">
                <span class="info-icon info-icon--level">${levelIcon}</span>
                <span class="info-label">难度：</span>
                <span class="info-value" id="levelDisplay" data-testid="level">${defaultLevel}</span>
            </div>
            <div class="info-group info-group--score">
                <span class="info-icon info-icon--score">${scoreIcon}</span>
                <span class="info-label">得分：</span>
                <span class="info-value score-value" id="scoreDisplay" data-testid="score">0</span>
            </div>
        </div>
    </div>`;

    if (levelNotice) {
        html += `
    <div class="levelup-notice hidden" id="levelupNotice" data-notice-tone="upgrade" data-testid="level-notice">
        <span class="levelup-notice-title" id="levelupTitle">难度升级</span>
        <span class="levelup-notice-desc" id="levelupDesc">新的难度已经生效</span>
    </div>`;
    }

    return html;
}

/**
 * 确保 TopBar 已挂载（结算「继续训练」复用 DOM，避免反复 innerHTML 重建）
 * @param {HTMLElement|null|undefined} mountNode - 通常为 #topBarMount
 * @param {Object} [options] - 同 createTopBarHTML
 * @returns {{ created: boolean, root: Element|null }}
 */
export function ensureTopBarMounted(mountNode, options = {}) {
    if (!mountNode) return { created: false, root: null };
    const existing = mountNode.querySelector('.top-bar');
    if (existing) return { created: false, root: existing };
    mountNode.innerHTML = createTopBarHTML(options);
    return { created: true, root: mountNode.querySelector('.top-bar') };
}

// =================== DOM 引用 ===================

/**
 * 获取顶部栏各元素 DOM 引用
 * @returns {{ timerDisplay: HTMLElement, scoreDisplay: HTMLElement, levelDisplay: HTMLElement, btnPause: HTMLButtonElement, levelupNotice: HTMLElement|null, levelupTitle: HTMLElement|null, levelupDesc: HTMLElement|null }}
 */
export function getTopBarRefs() {
    return {
        timerDisplay: document.getElementById('timerDisplay'),
        scoreDisplay: document.getElementById('scoreDisplay'),
        levelDisplay: document.getElementById('levelDisplay'),
        btnPause: document.getElementById('btnPause'),
        levelupNotice: document.getElementById('levelupNotice'),
        levelupTitle: document.getElementById('levelupTitle'),
        levelupDesc: document.getElementById('levelupDesc'),
    };
}

// =================== 格式化 ===================

/**
 * 将秒数格式化为 mm:ss
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

// =================== 运行时更新 ===================

/**
 * 更新计时器显示
 * @param {number} seconds - 剩余秒数
 * @param {number} [warningThreshold=10] - 低于此值显示警告动画
 */
export function updateTimer(seconds, warningThreshold = 10) {
    const el = document.getElementById('timerDisplay');
    if (!el) return;
    const text = formatTime(seconds);
    // 文本未变时跳过 DOM 操作，避免与 WebGL 渲染循环争抢主线程
    if (el.textContent !== text) el.textContent = text;
    const shouldWarn = seconds <= warningThreshold;
    if (el.classList.contains('warning') !== shouldWarn) {
        el.classList.toggle('warning', shouldWarn);
    }
}

/**
 * 更新得分显示（附带弹跳动画）
 * @param {number} score
 */
export function updateScore(score) {
    const el = document.getElementById('scoreDisplay');
    if (!el) return;
    const scoreStr = String(score);
    // 分数未变时跳过 DOM 写入和 reflow
    if (el.textContent === scoreStr) return;
    el.textContent = scoreStr;
    el.classList.remove('bump');
    // 用 rAF 替代 void el.offsetWidth 重启动画，避免强制同步重排
    requestAnimationFrame(() => {
        el.classList.add('bump');
    });
}

/**
 * 更新得分显示（不带动画，仅文本）
 * @param {number} score
 */
export function setScore(score) {
    const el = document.getElementById('scoreDisplay');
    const text = String(score);
    if (el && el.textContent !== text) el.textContent = text;
}

/**
 * 更新等级/难度显示
 * @param {string} text
 */
export function updateLevel(text) {
    const el = document.getElementById('levelDisplay');
    const nextText = String(text);
    if (el && el.textContent !== nextText) el.textContent = nextText;
}

// =================== 等级通知条 ===================

/**
 * 显示等级变化通知
 * @param {Object} [options]
 * @param {string} [options.tone='upgrade'] - 色调：upgrade / downgrade / warning / end
 * @param {string} [options.title='难度升级']
 * @param {string} [options.desc='新的难度已经生效']
 * @param {number} [options.durationMs=2200] - 自动隐藏延迟（ms）
 * @returns {number|undefined} setTimeout id，可用于提前取消
 */
export function showLevelNotice({
    tone = 'upgrade',
    title = '难度升级',
    desc = '新的难度已经生效',
    durationMs = 2200,
} = {}) {
    const notice = document.getElementById('levelupNotice');
    if (!notice) return;

    const titleEl = document.getElementById('levelupTitle');
    const descEl = document.getElementById('levelupDesc');
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    notice.dataset.noticeTone = tone;

    notice.classList.remove('show', 'hidden');
    requestAnimationFrame(() => {
        notice.classList.add('show');
    });

    return setTimeout(() => {
        notice.classList.remove('show');
        notice.classList.add('hidden');
    }, durationMs);
}

/**
 * 立即隐藏等级通知条
 * @param {number} [timerId] - showLevelNotice 返回的 timer id
 */
export function hideLevelNotice(timerId) {
    if (timerId) clearTimeout(timerId);
    const notice = document.getElementById('levelupNotice');
    if (!notice) return;
    notice.classList.remove('show');
    notice.classList.add('hidden');
}
