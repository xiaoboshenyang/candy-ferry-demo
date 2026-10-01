// =================== 介绍页顶部栏 — 通用组件 ===================

/**
 * 生成介绍页顶部栏 HTML
 *
 * 结构：返回按钮 | 居中标题胶囊 | 右侧最高得分胶囊
 *
 * @param {Object} options
 * @param {string} options.title - 游戏显示名称
 * @param {string} [options.homeAction='window.game.handleIntroHome()'] - 返回首页的 onclick 表达式
 * @param {string} [options.homeAriaLabel='介绍页主页'] - 返回按钮无障碍标签
 * @param {string} [options.recordLabel='最高得分'] - 得分标签前缀
 * @param {string} [options.recordDefault='--'] - 得分默认占位
 * @param {string} [options.extraClass=''] - 顶部栏容器附加类名
 * @param {string} [options.dataTestId='intro-top-bar'] - data-testid
 * @returns {string} HTML 字符串
 */
export function buildIntroTopbarHtml({
    title,
    homeAction = 'window.game.handleIntroHome()',
    homeAriaLabel = '介绍页主页',
    recordLabel = '最高得分',
    recordDefault = '--',
    extraClass = '',
    dataTestId = 'intro-top-bar',
} = {}) {
    const isDailyRecommend = new URLSearchParams(window.location.search).get('dailyRecommend') === '1';
    const resolvedAriaLabel = isDailyRecommend ? '返回今日训练' : homeAriaLabel;
    const cls = ['sm-intro-topbar', extraClass].filter(Boolean).join(' ');
    return `
        <div class="${cls}" data-testid="${dataTestId}">
            <button
                type="button"
                class="sm-back-btn sm-intro-topbar__home-btn${isDailyRecommend ? ' sm-intro-topbar__home-btn--daily' : ''}"
                aria-label="${resolvedAriaLabel}"
                onclick="${homeAction}"
            >
                <span class="sm-back-btn__icon" aria-hidden="true"></span>
                ${isDailyRecommend ? '<span class="sm-intro-topbar__home-label">返回今日训练</span>' : ''}
            </button>
            <div class="sm-intro-topbar__title">${title}</div>
            <div class="sm-intro-topbar__record" data-testid="best-record">
                <span class="sm-intro-topbar__record-icon" aria-hidden="true"></span>
                <span class="sm-intro-topbar__record-text">${recordLabel}：${recordDefault}</span>
            </div>
        </div>
    `;
}

/**
 * 更新顶部栏最高得分文案
 * @param {number|string|null|undefined} bestScore
 * @param {Object} [options]
 * @param {string} [options.label='最高得分'] - 前缀标签
 * @param {string} [options.fallback='--'] - 无数据时的占位
 * @param {string} [options.selector='.sm-intro-topbar__record-text'] - 目标元素选择器
 */
export function updateIntroRecordText(bestScore, {
    label = '最高得分',
    fallback = '--',
    selector = '.sm-intro-topbar__record-text',
} = {}) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.textContent = `${label}：${bestScore ?? fallback}`;
}
