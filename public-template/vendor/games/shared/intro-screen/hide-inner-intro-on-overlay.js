// =================== 全屏介绍打开时是否隐藏 inner 介绍页 ===================

/** 关闭隐藏时加在 html / body / 介绍屏上的类名 */
export const KEEP_INNER_INTRO_ON_OVERLAY_CLASS = 'sm-keep-inner-intro-on-overlay';

/** URL 查询参数。`?hideInnerIntro=0` 关闭隐藏，`=1` 保持隐藏 */
export const HIDE_INNER_INTRO_ON_OVERLAY_PARAM = 'hideInnerIntro';

/** 默认：全屏介绍打开时隐藏底下 inner 介绍页 */
export const HIDE_INNER_INTRO_ON_OVERLAY_DEFAULT = true;

const FALSE_TOKENS = new Set(['0', 'false', 'off', 'no']);
const TRUE_TOKENS = new Set(['1', 'true', 'on', 'yes']);

function toSearchParams(search) {
    if (search instanceof URLSearchParams) {
        return search;
    }
    return new URLSearchParams(String(search ?? ''));
}

function normalizeSearchList(search) {
    if (search == null || search === '') {
        return [];
    }
    if (Array.isArray(search)) {
        return search.filter((item) => item != null && item !== '');
    }
    return [search];
}

/**
 * 收集当前可用的查询串：游戏自身 URL 优先，同源宿主页作为回退。
 * 宿主 `localhost:3000/?hideInnerIntro=0` 不会自动出现在 iframe search 里。
 * @returns {Array<string|URLSearchParams>}
 */
export function getDefaultHideInnerIntroSearchInputs() {
    const inputs = [];
    if (typeof window === 'undefined') {
        return inputs;
    }
    try {
        if (window.location?.search) {
            inputs.push(window.location.search);
        }
    } catch {
        // ignore
    }
    try {
        if (window.parent && window.parent !== window && window.parent.location?.search) {
            inputs.push(window.parent.location.search);
        }
    } catch {
        // 跨域宿主读不到 parent.location
    }
    return inputs;
}

/**
 * 从 URL 读取开关。未出现该参数时返回 null，表示沿用默认或调用方显式值。
 * @param {string|URLSearchParams} [search]
 * @returns {boolean|null}
 */
export function readHideInnerIntroOnOverlayFromSearch(search) {
    if (search == null || search === '') {
        return null;
    }
    const raw = toSearchParams(search).get(HIDE_INNER_INTRO_ON_OVERLAY_PARAM);
    if (raw == null || String(raw).trim() === '') {
        return null;
    }
    const token = String(raw).trim().toLowerCase();
    if (FALSE_TOKENS.has(token)) {
        return false;
    }
    if (TRUE_TOKENS.has(token)) {
        return true;
    }
    return null;
}

/**
 * 从一组查询串中读取开关，前者优先。
 * @param {string|URLSearchParams|Array<string|URLSearchParams>} [searches]
 * @returns {boolean|null}
 */
export function readHideInnerIntroOnOverlayFromSearches(searches) {
    for (const search of normalizeSearchList(searches)) {
        const value = readHideInnerIntroOnOverlayFromSearch(search);
        if (value !== null) {
            return value;
        }
    }
    return null;
}

/**
 * 解析最终开关：URL 显式值优先，其次调用方 enabled，否则默认隐藏。
 * @param {Object} [options]
 * @param {boolean} [options.enabled]
 * @param {string|URLSearchParams|Array<string|URLSearchParams>} [options.search]
 * @returns {boolean}
 */
export function resolveHideInnerIntroOnOverlay({
    enabled,
    search,
} = {}) {
    const fromSearch = readHideInnerIntroOnOverlayFromSearches(search);
    if (fromSearch !== null) {
        return fromSearch;
    }
    if (typeof enabled === 'boolean') {
        return enabled;
    }
    return HIDE_INNER_INTRO_ON_OVERLAY_DEFAULT;
}

/**
 * 在目标节点上切换 opt-out 类。enabled=false 时保留 inner 介绍页。
 * @param {boolean} enabled
 * @param {Element} [target]
 * @returns {boolean}
 */
export function setHideInnerIntroOnOverlay(enabled, target) {
    if (!target?.classList) {
        return enabled !== false;
    }
    target.classList.toggle(KEEP_INNER_INTRO_ON_OVERLAY_CLASS, enabled === false);
    return enabled !== false;
}

/**
 * 当前目标是否仍会隐藏 inner 介绍页（未挂 opt-out 类）。
 * @param {Element} [target]
 * @returns {boolean}
 */
export function isHideInnerIntroOnOverlayEnabled(target) {
    return !target?.classList?.contains(KEEP_INNER_INTRO_ON_OVERLAY_CLASS);
}

/**
 * 按 URL / 显式配置把开关写到目标节点。
 * URL 未出现且未传 enabled 时不改 class，保持 CSS 默认隐藏。
 * @param {Object} [options]
 * @param {boolean} [options.enabled]
 * @param {string|URLSearchParams|Array<string|URLSearchParams>} [options.search]
 * @param {Element} [options.target]
 * @returns {boolean} 解析后的开关值
 */
export function applyHideInnerIntroOnOverlayPreference({
    enabled,
    search,
    target,
} = {}) {
    const fromSearch = readHideInnerIntroOnOverlayFromSearches(search);
    if (fromSearch !== null) {
        setHideInnerIntroOnOverlay(fromSearch, target);
        return fromSearch;
    }
    if (typeof enabled === 'boolean') {
        setHideInnerIntroOnOverlay(enabled, target);
        return enabled;
    }
    return HIDE_INNER_INTRO_ON_OVERLAY_DEFAULT;
}
