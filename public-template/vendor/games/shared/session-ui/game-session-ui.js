import { hideTimeUp, showTimeUp } from '../time-up/game-time-up.js';
import {
  playManagedGameFeedbackAudio,
  preloadGameFeedbackAudio,
  preloadManagedGameFeedbackAudio,
} from '../feedback-audio/game-feedback-audio.js';

function buildElementFromTemplate(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    return template.content.firstElementChild;
}

export function getGameListUrl() {
    return new URL('../../game/', window.location.href).toString();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function exitToGameList({ fallbackDelayMs = 2000, dailyRecommendAction = '' } = {}) {
    const gameListUrl = getGameListUrl();

    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
        try {
            window.parent.postMessage({
                type: 'gameExited',
                ...(dailyRecommendAction ? { data: { dailyRecommendAction } } : {}),
            }, '*');
            window.setTimeout(() => {
                window.location.assign(gameListUrl);
            }, fallbackDelayMs);
            return;
        } catch (error) {
            console.warn('[GameSessionUI] 通知宿主退出失败，改为本页跳转:', error);
        }
    }

    window.location.assign(gameListUrl);
}

export function createSharedSessionUI({
    mountNode,
    timeupTitle = '时间到',
    timeupText = '本轮训练结束，正在整理你的结果。',
    timeupMode = 'inline',
    timeupTestId = 'timeup-page',
    countdownSeconds = 3,
    countdownGoText = '开始',
    sessionClassName = '',
    playCountdownSound = true,
    onConfirmExit,
    onCancelExit,
} = {}) {
    if (!mountNode) {
        throw new Error('createSharedSessionUI 需要 mountNode');
    }

    const useSharedTimeupComponent = timeupMode === 'component';
    let countdownTimerId = null;
    let currentTimeupTitle = timeupTitle;
    let currentTimeupText = timeupText;

    const timeupScreenHtml = useSharedTimeupComponent
        ? ''
        : `
            <div id="timeup-page" class="sm-session-overlay sm-session-overlay--timeup hidden" data-testid="${escapeHtml(timeupTestId)}">
                <p id="timeup-title" class="sm-session-timeup-title">${escapeHtml(timeupTitle)}</p>
                <p id="timeup-text" class="sm-session-timeup-text">${escapeHtml(timeupText)}</p>
            </div>
        `;

    const sessionRoot = buildElementFromTemplate(`
        <div class="sm-session-layer ${sessionClassName}">
            <div id="countdown-page" class="sm-session-overlay sm-session-overlay--countdown hidden" data-testid="countdown-page">
                <div class="sm-session-countdown-panel">
                    <div id="countdown-number" class="sm-session-countdown-number" data-testid="countdown-number">${escapeHtml(countdownSeconds)}</div>
                </div>
            </div>

            <div id="confirm-exit-page" class="sm-session-overlay sm-session-overlay--dialog hidden" data-testid="confirm-exit-page">
                <div class="sm-session-dialog-card">
                    <div class="sm-session-dialog-body">
                        <div class="sm-session-dialog-icon">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M24 18.5L24 43.5" stroke="white" stroke-width="8" stroke-linecap="round"/>
                                <circle cx="24" cy="6.5" r="4" fill="white"/>
                            </svg>
                        </div>
                        <div class="sm-session-dialog-title-wrap">
                            <h2 class="sm-session-dialog-title">确认退出训练吗？</h2>
                        </div>
                    </div>
                    <div class="sm-session-dialog-actions">
                        <button type="button" class="sm-session-dialog-btn sm-session-dialog-btn--secondary" data-session-action="cancel-exit">
                            <span class="sm-session-dialog-btn-label sm-session-dialog-btn-label--secondary">暂不退出</span>
                        </button>
                        <button type="button" class="sm-session-dialog-btn sm-session-dialog-btn--primary" data-session-action="confirm-exit">
                            <span class="sm-session-dialog-btn-label sm-session-dialog-btn-label--primary">确认退出</span>
                        </button>
                    </div>
                </div>
            </div>

            ${timeupScreenHtml}
        </div>
    `);

    mountNode.appendChild(sessionRoot);

    sessionRoot.querySelector('[data-session-action="confirm-exit"]')?.addEventListener('click', () => {
        if (typeof onConfirmExit === 'function') {
            onConfirmExit();
        }
    });

    sessionRoot.querySelector('[data-session-action="cancel-exit"]')?.addEventListener('click', () => {
        if (typeof onCancelExit === 'function') {
            onCancelExit();
        }
    });

    function setHidden(id, hidden) {
        const element = sessionRoot.querySelector(`#${id}`);
        if (element) {
            element.classList.toggle('hidden', hidden);
        }
    }

    function cancelCountdownTimer() {
        if (countdownTimerId != null) {
            clearInterval(countdownTimerId);
            countdownTimerId = null;
        }
    }

    function setCountdownActive(active) {
        mountNode.classList.toggle('sm-session-countdown-active', active);
    }

    function setCountdownDisplay(value, { animate = false } = {}) {
        const numberNode = sessionRoot.querySelector('#countdown-number');
        if (!numberNode) return;

        const text = String(value);
        const isGoText = Boolean(countdownGoText) && text === countdownGoText;
        numberNode.textContent = text;
        numberNode.classList.toggle('sm-session-countdown-number--go', isGoText);
        numberNode.classList.remove('sm-session-countdown-pop');
        if (animate) {
            void numberNode.offsetWidth;
            numberNode.classList.add('sm-session-countdown-pop');
        }
    }

    function resetCountdownDisplay() {
        const numberNode = sessionRoot.querySelector('#countdown-number');
        if (!numberNode) return;

        numberNode.getAnimations?.().forEach((animation) => animation.cancel());
        numberNode.classList.remove('sm-session-countdown-number--go', 'sm-session-countdown-pop');
        numberNode.textContent = String(countdownSeconds);
    }

    const sessionApi = {
        root: sessionRoot,
        setCountdownValue(value, options) {
            setCountdownDisplay(value, options);
        },
        setTimeupContent(title = timeupTitle, text = timeupText) {
            currentTimeupTitle = title;
            currentTimeupText = text;
            const titleNode = sessionRoot.querySelector('#timeup-title');
            const textNode = sessionRoot.querySelector('#timeup-text');
            if (titleNode) titleNode.textContent = title;
            if (textNode) textNode.textContent = text;
        },
        preloadCountdownAudio() {
            if (playCountdownSound) {
                preloadManagedGameFeedbackAudio('countdownSequence');
            }
            // 时间到走 one-shot 通道（showTimeUp），与倒计时的 managed 通道分开预热
            preloadGameFeedbackAudio('timeUp');
        },
        showCountdown() {
            setCountdownActive(true);
            setHidden('countdown-page', false);
        },
        hideCountdown() {
            cancelCountdownTimer();
            setCountdownActive(false);
            setHidden('countdown-page', true);
        },
        runCountdown({ onTick, onComplete, soundEnabled = true } = {}) {
            cancelCountdownTimer();
            resetCountdownDisplay();
            let count = countdownSeconds;

            // 预加载并播放倒计时音效。
            // 与 housework-master 一致：调用方在点击手势里先 unlock，这里同步开播。
            // 不要再包一层 unlock().then(play)：会和游戏侧的预播叠加，stop 后被节流静默。
            if (playCountdownSound && soundEnabled) {
                playManagedGameFeedbackAudio('countdownSequence');
            }

            setCountdownDisplay(count);
            setCountdownActive(true);
            setHidden('countdown-page', false);
            if (typeof onTick === 'function') {
                onTick(String(count));
            }

            countdownTimerId = setInterval(() => {
                count -= 1;

                if (count > 0) {
                    setCountdownDisplay(count, { animate: true });
                    if (typeof onTick === 'function') {
                        onTick(String(count));
                    }
                    return;
                }

                if (count === 0 && countdownGoText) {
                    setCountdownDisplay(countdownGoText, { animate: true });
                    if (typeof onTick === 'function') {
                        onTick(countdownGoText);
                    }
                    return;
                }

                cancelCountdownTimer();
                setCountdownActive(false);
                setHidden('countdown-page', true);
                setCountdownDisplay(countdownSeconds);
                if (typeof onComplete === 'function') {
                    onComplete();
                }
            }, 1000);
        },
        cancelCountdown() {
            cancelCountdownTimer();
            setCountdownActive(false);
            setHidden('countdown-page', true);
            setCountdownDisplay(countdownSeconds);
        },
        showTimeup(options = {}) {
            if (useSharedTimeupComponent) {
                const {
                    text,
                    duration,
                    container = mountNode,
                    backdrop,
                    playSound,
                    onComplete,
                } = options;
                showTimeUp({
                    text: text || currentTimeupTitle || currentTimeupText || timeupTitle,
                    duration,
                    container,
                    backdrop,
                    playSound,
                    onComplete,
                });
                return;
            }

            setHidden('timeup-page', false);
        },
        hideTimeup(options = {}) {
            if (useSharedTimeupComponent) {
                hideTimeUp(options);
                return;
            }

            setHidden('timeup-page', true);
        },
        showExitDialog() {
            setHidden('confirm-exit-page', false);
        },
        hideExitDialog() {
            setHidden('confirm-exit-page', true);
        },
        destroy() {
            cancelCountdownTimer();
            setCountdownActive(false);
            if (useSharedTimeupComponent) {
                hideTimeUp();
            }
            sessionRoot.remove();
        },
    };

    sessionApi.preloadCountdownAudio();
    return sessionApi;
}
