// =================== 介绍屏幕 ===================

import { joinClasses, setAttr, buildElementFromTemplate } from '../utils/standalone-flow-utils.js';
import {
    KEEP_INNER_INTRO_ON_OVERLAY_CLASS,
    applyHideInnerIntroOnOverlayPreference,
    getDefaultHideInnerIntroSearchInputs,
} from './hide-inner-intro-on-overlay.js';

/**
 * 创建介绍屏幕 DOM 元素
 * @param {Object} options - 介绍屏幕配置
 * @param {boolean} [options.hideInnerIntroOnOverlay=true] - 全屏演示打开时是否隐藏底下 inner 介绍页
 * @returns {Element}
 */
export function createIntroScreen({
    id,
    visible = false,
    dataTestId,
    extraClasses = '',
    themeClass = '',
    panelClass = '',
    topHtml = '',
    leadHtml = '',
    leftHtml = '',
    rightHtml = '',
    mainActionsHtml = '',
    beforeActionsHtml = '',
    actionsHtml = '',
    hideInnerIntroOnOverlay,
}) {
    const hasRightSlot = Boolean(rightHtml && rightHtml.trim());
    const hasBeforeActions = Boolean(beforeActionsHtml && beforeActionsHtml.trim());
    const mainContentClassName = joinClasses('sm-flow-main-content', !hasRightSlot && 'sm-flow-main-content--single');
    const keepInnerIntroClass = hideInnerIntroOnOverlay === false
        ? KEEP_INNER_INTRO_ON_OVERLAY_CLASS
        : '';
    if (typeof document !== 'undefined') {
        applyHideInnerIntroOnOverlayPreference({
            search: getDefaultHideInnerIntroSearchInputs(),
            target: document.documentElement,
        });
    }
    const screen = buildElementFromTemplate(`
        <section class="${joinClasses(
            'sm-flow-screen',
            'sm-flow-screen--intro',
            themeClass,
            extraClasses,
            keepInnerIntroClass,
            !visible && 'hidden'
        )}">
            <div class="${joinClasses('sm-flow-panel', 'sm-flow-panel--intro', panelClass)}">
                <div class="sm-flow-top hidden"></div>
                <div class="sm-flow-lead hidden"></div>
                <div class="${joinClasses('sm-flow-main', !hasRightSlot && 'sm-flow-main--single')}">
                    <div class="${mainContentClassName}">
                        <div class="sm-flow-slot sm-flow-slot--left"></div>
                        ${hasRightSlot ? '<div class="sm-flow-slot sm-flow-slot--right"></div>' : ''}
                    </div>
                    <div class="sm-flow-main-actions hidden"></div>
                </div>
                ${hasBeforeActions ? '<div class="sm-flow-before-actions"></div>' : ''}
                <div class="sm-flow-actions hidden"></div>
            </div>
        </section>
    `);

    setAttr(screen, 'id', id);
    setAttr(screen, 'data-testid', dataTestId);

    const topNode = screen.querySelector('.sm-flow-top');
    const leadNode = screen.querySelector('.sm-flow-lead');
    const leftNode = screen.querySelector('.sm-flow-slot--left');
    const rightNode = screen.querySelector('.sm-flow-slot--right');
    const mainActionsNode = screen.querySelector('.sm-flow-main-actions');
    const beforeActionsNode = screen.querySelector('.sm-flow-before-actions');
    const actionsNode = screen.querySelector('.sm-flow-actions');

    if (topNode) {
        topNode.innerHTML = topHtml;
        topNode.classList.toggle('hidden', !topHtml);
    }
    if (leadNode) {
        leadNode.innerHTML = leadHtml;
        leadNode.classList.toggle('hidden', !leadHtml);
    }
    if (leftNode) leftNode.innerHTML = leftHtml;
    if (rightNode) rightNode.innerHTML = rightHtml;
    if (mainActionsNode) {
        mainActionsNode.innerHTML = mainActionsHtml;
        mainActionsNode.classList.toggle('hidden', !mainActionsHtml);
    }
    if (beforeActionsNode) {
        beforeActionsNode.innerHTML = beforeActionsHtml;
    }
    if (actionsNode) {
        actionsNode.innerHTML = actionsHtml;
        actionsNode.classList.toggle('hidden', !actionsHtml);
    }

    return screen;
}
