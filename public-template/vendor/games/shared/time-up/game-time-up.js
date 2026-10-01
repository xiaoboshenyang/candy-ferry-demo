import { hideLevelUp, showLevelUp, setTimeUpLock } from '../level-up/game-level-up.js';

const TIME_UP_FREEZE_CLASS = 'sm-game-time-up-freeze';

let timeUpFreezeHost = null;

function freezeTimeUpHost(host) {
    if (!(host instanceof Element)) return;
    unfreezeTimeUpHost();
    timeUpFreezeHost = host;
    // CSS / WAAPI 冻结已由 showLevelUp 完成；这里只补时间到专用 class，给顶栏 warning 闪烁用。
    host.classList.add(TIME_UP_FREEZE_CLASS);
}

function unfreezeTimeUpHost() {
    if (!timeUpFreezeHost) return;
    timeUpFreezeHost.classList.remove(TIME_UP_FREEZE_CLASS);
    timeUpFreezeHost = null;
}

/** 时钟样式图标 SVG */
function createTimeUpIconSvg() {
    return `
        <svg class="sm-game-level-up-icon__svg" viewBox="0 0 176 176" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
            <defs>
                <radialGradient id="smTimeUpIconBg" cx="50%" cy="38%" r="70%">
                    <stop offset="0%" stop-color="#ffb24e" />
                    <stop offset="62%" stop-color="#ff8d1f" />
                    <stop offset="100%" stop-color="#f66e00" />
                </radialGradient>
                <filter id="smTimeUpIconShadow" x="-20%" y="-20%" width="140%" height="160%">
                    <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#9f3b00" flood-opacity="0.45" />
                </filter>
            </defs>
            <!-- 外环 -->
            <circle cx="88" cy="88" r="82" fill="#fff7f0" />
            <circle cx="88" cy="88" r="72" fill="url(#smTimeUpIconBg)" filter="url(#smTimeUpIconShadow)" />
            <!-- 表盘 -->
            <circle cx="88" cy="88" r="50" fill="#ffffff" opacity="0.95" />
            <circle cx="88" cy="88" r="46" fill="none" stroke="#f0ddc0" stroke-width="2" />
            <!-- 刻度 -->
            <g stroke="#ff8d1f" stroke-width="3" stroke-linecap="round">
                <line x1="88" y1="46" x2="88" y2="54" />
                <line x1="88" y1="122" x2="88" y2="130" />
                <line x1="46" y1="88" x2="54" y2="88" />
                <line x1="122" y1="88" x2="130" y2="88" />
            </g>
            <!-- 短刻度 -->
            <g stroke="#f0b87a" stroke-width="2" stroke-linecap="round">
                <line x1="109.3" y1="51.1" x2="105.8" y2="57.1" />
                <line x1="124.9" y1="66.7" x2="118.9" y2="70.2" />
                <line x1="124.9" y1="109.3" x2="118.9" y2="105.8" />
                <line x1="109.3" y1="124.9" x2="105.8" y2="118.9" />
                <line x1="66.7" y1="124.9" x2="70.2" y2="118.9" />
                <line x1="51.1" y1="109.3" x2="57.1" y2="105.8" />
                <line x1="51.1" y1="66.7" x2="57.1" y2="70.2" />
                <line x1="66.7" y1="51.1" x2="70.2" y2="57.1" />
            </g>
            <!-- 时针 -->
            <line x1="88" y1="88" x2="88" y2="62" stroke="#e06500" stroke-width="5" stroke-linecap="round" />
            <!-- 分针 -->
            <line x1="88" y1="88" x2="110" y2="76" stroke="#ff8d1f" stroke-width="3.5" stroke-linecap="round" />
            <!-- 中心圆点 -->
            <circle cx="88" cy="88" r="5" fill="#e06500" />
            <circle cx="88" cy="88" r="2.5" fill="#ffffff" />
        </svg>
    `;
}

export function showTimeUp(options = {}) {
    const {
        text = '时间到！',
        duration = 1500,
        container = document.body,
        backdrop = true,
        playSound = false,
        onComplete = null,
    } = options;

    const host = container instanceof Element ? container : document.body;
    const wrappedOnComplete = () => {
        unfreezeTimeUpHost();
        if (typeof onComplete === 'function') onComplete();
    };

    // 先调用 showLevelUp 走完容器挂载（可能触发容器变更时的锁自动释放），
    // 再把锁打开，避免被 initLevelUpOverlay 中的"容器变更释放锁"逻辑清掉。
    showLevelUp({
        text,
        duration,
        container: host,
        backdrop,
        playSound,
        sound: 'timeUp',
        iconSvg: createTimeUpIconSvg(),
        onComplete: wrappedOnComplete,
        __bypassTimeUpLock: true,
    });
    setTimeUpLock(true);
    freezeTimeUpHost(host);
}

export function hideTimeUp(options = {}) {
    const { onComplete = null } = options;
    hideLevelUp({
        ...options,
        onComplete: () => {
            unfreezeTimeUpHost();
            if (typeof onComplete === 'function') onComplete();
        },
    });
    // 结算流程对外结束后释放锁；下一局重新开始时仍建议显式调用 resetOverlayLock。
    setTimeUpLock(false);
}
