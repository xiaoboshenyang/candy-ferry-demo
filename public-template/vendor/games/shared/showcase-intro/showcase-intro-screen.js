// =================== 展示型介绍页组件 ===================

import { createIntroScreen } from '../intro-screen/intro-screen.js';
import { joinClasses, setAttr } from '../utils/standalone-flow-utils.js';

/**
 * 创建展示型介绍页。
 * 适用于顶部栏 + 左侧演示区 + 右侧说明区 + 底部主操作的双栏介绍页。
 * @param {Object} options - 介绍页配置
 * @param {boolean} [options.hideInnerIntroOnOverlay=true] - 全屏演示打开时是否隐藏底下 inner 介绍页
 * @returns {Element}
 */
export function createShowcaseIntroScreen({
    id,
    visible = false,
    dataTestId,
    extraClasses = '',
    themeClass = '',
    panelClass = '',
    topHtml = '',
    leadHtml = '',
    showcaseHtml = '',
    guideHtml = '',
    mainActionsHtml = '',
    beforeActionsHtml = '',
    actionsHtml = '',
    leadClass = '',
    showcaseClass = '',
    guideClass = '',
    mainActionsClass = '',
    mainContentClass = '',
    mainContentTestId,
    hideInnerIntroOnOverlay,
}) {
    const screen = createIntroScreen({
        id,
        visible,
        dataTestId,
        extraClasses: joinClasses('sm-showcase-intro-screen', extraClasses),
        themeClass,
        panelClass: joinClasses('sm-showcase-intro-panel', panelClass),
        hideInnerIntroOnOverlay,
        topHtml,
        leadHtml: leadHtml
            ? `<div class="${joinClasses('sm-showcase-intro-lead', leadClass)}">${leadHtml}</div>`
            : '',
        leftHtml: showcaseHtml
            ? `<div class="${joinClasses('sm-showcase-intro-showcase', showcaseClass)}">${showcaseHtml}</div>`
            : '',
        rightHtml: guideHtml
            ? `<div class="${joinClasses('sm-showcase-intro-guide', guideClass)}">${guideHtml}</div>`
            : '',
        mainActionsHtml: mainActionsHtml
            ? `<div class="${joinClasses('sm-showcase-intro-main-actions', mainActionsClass)}">${mainActionsHtml}</div>`
            : '',
        beforeActionsHtml,
        actionsHtml,
    });

    const mainNode = screen.querySelector('.sm-flow-main');
    const mainContentNode = screen.querySelector('.sm-flow-main-content');

    mainNode?.classList.add('sm-showcase-intro-main');
    if (mainContentNode) {
        mainContentNode.classList.add('sm-showcase-intro-content');
        if (mainContentClass) {
            mainContentNode.classList.add(...mainContentClass.split(/\s+/).filter(Boolean));
        }
        setAttr(mainContentNode, 'data-testid', mainContentTestId);
    }

    return screen;
}

// =================== 通用操作按钮工具 ===================

/**
 * 生成展示型介绍页底部主操作区 HTML。
 * 包含「开始训练」和「继续训练」两个按钮：
 * 默认只显示「开始训练」，调用 setShowcaseIntroScreenPaused(screen, true) 后切到「继续训练」。
 * @param {Object} [options]
 * @param {string} [options.startText='开始训练']
 * @param {string} [options.resumeText='继续训练']
 * @param {string} [options.startId=''] - 可选按钮 id
 * @param {string} [options.resumeId=''] - 可选按钮 id
 * @param {string} [options.startTestId='start-btn']
 * @param {string} [options.resumeTestId='resume-btn']
 * @returns {string}
 */
export function buildShowcaseIntroActionsHtml({
    startText = '开始训练',
    resumeText = '继续训练',
    startId = '',
    resumeId = '',
    startTestId = 'start-btn',
    resumeTestId = 'resume-btn',
} = {}) {
    const startIdAttr = startId ? ` id="${startId}"` : '';
    const resumeIdAttr = resumeId ? ` id="${resumeId}"` : '';
    return `
        <button
            class="sm-showcase-intro-btn"
            type="button"
            data-sm-action="start"${startIdAttr}
            data-testid="${startTestId}"
        >${startText}</button>
        <button
            class="sm-showcase-intro-btn hidden"
            type="button"
            data-sm-action="resume"${resumeIdAttr}
            data-testid="${resumeTestId}"
        >${resumeText}</button>
    `;
}

/**
 * 切换展示型介绍页的暂停 / 初始状态，控制两个操作按钮的显示。
 * @param {Element} screen - createShowcaseIntroScreen 返回的屏幕元素
 * @param {boolean} isPaused - true 显示「继续训练」，false 显示「开始训练」
 */
export function setShowcaseIntroScreenPaused(screen, isPaused) {
    const startBtn = screen?.querySelector('[data-sm-action="start"]');
    const resumeBtn = screen?.querySelector('[data-sm-action="resume"]');
    startBtn?.classList.toggle('hidden', isPaused);
    resumeBtn?.classList.toggle('hidden', !isPaused);
}

// =================== 通用 Demo 壳层工具 ===================

const DEFAULT_DEMO_OVERLAY_CLOSE_ICON_HTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M19 5L5 19M5 5L19 19" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

const DEFAULT_DEMO_CARD_FULLSCREEN_ICON_HTML = '<span class="sm-showcase-demo-fullscreen-btn__icon" aria-hidden="true"></span>';

function buildOptionalAttr(name, value) {
    return value ? ` ${name}="${value}"` : '';
}

/**
 * 生成展示型介绍页左侧通用演示卡壳层 HTML。
 * 演示舞台内容通过 stageHtml 插槽传入，由各游戏自行实现。
 * @param {Object} [options]
 * @returns {string}
 */
export function buildShowcaseDemoCardHtml({
    stageHtml = '',
    voiceText = '',
    badgeText = '演示教学',
    buttonText = '全屏播放',
    buttonIconHtml = '',
    panelClass = '',
    cardClass = '',
    stageShellClass = '',
    badgeClass = '',
    actionsClass = '',
    buttonClass = '',
    voiceCardClass = '',
    voiceIconClass = '',
    voiceCopyClass = '',
    buttonId = '',
    buttonTestId = 'intro-demo-fullscreen',
    cardTestId = 'intro-demo-card',
    voiceCardTestId = 'intro-voice-card',
} = {}) {
    const buttonIdAttr = buildOptionalAttr('id', buttonId);
    const buttonTestIdAttr = buildOptionalAttr('data-testid', buttonTestId);
    const cardTestIdAttr = buildOptionalAttr('data-testid', cardTestId);
    const voiceCardTestIdAttr = buildOptionalAttr('data-testid', voiceCardTestId);
    const buttonIconMarkup = buttonIconHtml || DEFAULT_DEMO_CARD_FULLSCREEN_ICON_HTML;

    return `
        <div class="${joinClasses('sm-showcase-demo-panel', panelClass)}">
            <div class="${joinClasses('sm-showcase-demo-card', cardClass)}"${cardTestIdAttr}>
                <div class="${joinClasses('sm-showcase-demo-stage-shell', stageShellClass)}">
                    <div class="${joinClasses('sm-showcase-demo-stage-badge', badgeClass)}">${badgeText}</div>
                    ${stageHtml}
                    <div class="${joinClasses('sm-showcase-demo-stage-actions', actionsClass)}">
                        <button
                            type="button"
                            class="${joinClasses('sm-showcase-demo-fullscreen-btn', buttonClass)}"${buttonIdAttr}${buttonTestIdAttr}
                        >
                            ${buttonIconMarkup}
                            <span>${buttonText}</span>
                        </button>
                    </div>
                </div>
                <div class="${joinClasses('sm-showcase-demo-voice-card', voiceCardClass)}"${voiceCardTestIdAttr}>
                    <div class="${joinClasses('sm-showcase-demo-voice-icon', voiceIconClass)}" aria-hidden="true"></div>
                    <div class="${joinClasses('sm-showcase-demo-voice-copy', voiceCopyClass)}">${voiceText}</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 生成展示型介绍页全屏演示弹层壳层 HTML。
 * 演示舞台内容通过 overlayStageHtml 插槽传入，由各游戏自行实现。
 * @param {Object} [options]
 * @returns {string}
 */
export function buildShowcaseDemoOverlayHtml({
    overlayStageHtml = '',
    captionText = '',
    badgeText = '演示教学',
    overlayId = 'demoOverlay',
    overlayTestId = 'demo-overlay',
    closeButtonId = 'btnCloseDemoOverlay',
    closeButtonTestId = '',
    closeButtonAriaLabel = '关闭演示弹层',
    captionId = 'demoOverlayCaption',
    captionTestId = '',
    overlayClass = '',
    stageWrapperClass = '',
    badgeClass = '',
    closeButtonClass = '',
    captionClass = '',
    closeButtonContentHtml = DEFAULT_DEMO_OVERLAY_CLOSE_ICON_HTML,
} = {}) {
    const overlayIdAttr = buildOptionalAttr('id', overlayId);
    const overlayTestIdAttr = buildOptionalAttr('data-testid', overlayTestId);
    const closeButtonIdAttr = buildOptionalAttr('id', closeButtonId);
    const closeButtonTestIdAttr = buildOptionalAttr('data-testid', closeButtonTestId);
    const captionIdAttr = buildOptionalAttr('id', captionId);
    const captionTestIdAttr = buildOptionalAttr('data-testid', captionTestId);

    return `
        <div class="${joinClasses('sm-showcase-demo-overlay', overlayClass, 'hidden')}"${overlayIdAttr}${overlayTestIdAttr}>
            <button
                type="button"
                class="${joinClasses('sm-showcase-demo-overlay-close', closeButtonClass)}"${closeButtonIdAttr}${closeButtonTestIdAttr}
                aria-label="${closeButtonAriaLabel}"
            >
                ${closeButtonContentHtml}
            </button>
            <div class="${joinClasses('sm-showcase-demo-overlay-stage-wrapper', stageWrapperClass)}">
                <div class="${joinClasses('sm-showcase-demo-stage-badge', badgeClass)}">${badgeText}</div>
                ${overlayStageHtml}
            </div>
            <div class="${joinClasses('sm-showcase-demo-overlay-caption', captionClass)}"${captionIdAttr}${captionTestIdAttr}>${captionText}</div>
        </div>
    `;
}

// =================== 通用 Guide 卡片工具 ===================

/**
 * 生成展示型介绍页右侧 Guide 卡片列表 HTML。
 * 每张卡片包含标题（label）+ 正文（bodyHtml）或能力标签（chips）。
 * @param {Object[]} cards - 卡片定义数组
 * @param {string} cards[].label - 卡片标题
 * @param {string} [cards[].bodyHtml] - 正文 HTML（与 chips 二选一）
 * @param {string[]} [cards[].chips] - 能力标签文本数组（与 bodyHtml 二选一）
 * @param {string} [cards[].testId] - 可选 data-testid
 * @param {Object} [options]
 * @param {string} [options.listTestId='intro-side-cards']
 * @param {string} [options.listClass=''] - 附加到列表容器的 class
 * @returns {string}
 */
export function buildShowcaseGuideHtml(cards = [], {
    listTestId = 'intro-side-cards',
    listClass = '',
} = {}) {
    const cardsHtml = cards.map((card) => {
        const testIdAttr = card.testId ? ` data-testid="${card.testId}"` : '';
        let contentHtml = '';
        if (card.chips && card.chips.length > 0) {
            const chipsHtml = card.chips
                .map((text) => `<span class="sm-showcase-intro-ability-chip">${text}</span>`)
                .join('');
            contentHtml = `<div class="sm-showcase-intro-ability-chips">${chipsHtml}</div>`;
        } else if (card.bodyHtml) {
            contentHtml = `<div class="sm-showcase-intro-guide-card-body">${card.bodyHtml}</div>`;
        }
        return `
            <section class="sm-showcase-intro-guide-card"${testIdAttr}>
                <div class="sm-showcase-intro-guide-card-label">${card.label || ''}</div>
                ${contentHtml}
            </section>`;
    }).join('');

    const cls = ['sm-showcase-intro-guide-list', listClass].filter(Boolean).join(' ');
    return `<div class="${cls}" data-testid="${listTestId}">${cardsHtml}</div>`;
}

/**
 * 设置指定 Guide 卡片的标题文本。
 * @param {Element} screen - createShowcaseIntroScreen 返回的屏幕元素
 * @param {number} cardIndex - 卡片索引（0-based）
 * @param {string} text - 新标题文本
 */
export function setShowcaseGuideCardLabel(screen, cardIndex, text) {
    const label = screen?.querySelectorAll('.sm-showcase-intro-guide-card-label')?.[cardIndex];
    if (label) label.textContent = text;
}

/**
 * 设置指定 Guide 卡片的正文内容（HTML 字符串）。
 * @param {Element} screen - createShowcaseIntroScreen 返回的屏幕元素
 * @param {number} cardIndex - 卡片索引（0-based）
 * @param {string} html - 新正文 HTML
 */
export function setShowcaseGuideCardBody(screen, cardIndex, html) {
    const card = screen?.querySelectorAll('.sm-showcase-intro-guide-card')?.[cardIndex];
    if (!card) return;
    let body = card.querySelector('.sm-showcase-intro-guide-card-body');
    if (!body) {
        body = document.createElement('div');
        body.className = 'sm-showcase-intro-guide-card-body';
        card.appendChild(body);
    }
    body.innerHTML = html;
}

/**
 * 设置指定 Guide 卡片的能力标签（chips）。
 * @param {Element} screen - createShowcaseIntroScreen 返回的屏幕元素
 * @param {number} cardIndex - 卡片索引（0-based）
 * @param {string[]} chips - 标签文本数组
 */
export function setShowcaseGuideChips(screen, cardIndex, chips = []) {
    const card = screen?.querySelectorAll('.sm-showcase-intro-guide-card')?.[cardIndex];
    if (!card) return;
    let container = card.querySelector('.sm-showcase-intro-ability-chips');
    if (!container) {
        container = document.createElement('div');
        container.className = 'sm-showcase-intro-ability-chips';
        card.appendChild(container);
    }
    container.innerHTML = chips
        .map((text) => `<span class="sm-showcase-intro-ability-chip">${text}</span>`)
        .join('');
}
