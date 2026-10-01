// =================== 通用工具函数 ===================

/**
 * 合并 CSS 类名，过滤掉空值和 falsy 值
 * @param {...(string|string[]|false|null|undefined)} parts
 * @returns {string}
 */
export function joinClasses(...parts) {
    return parts.flat().filter(Boolean).join(' ');
}

/**
 * 安全设置元素属性，跳过空值
 * @param {Element} element
 * @param {string} name
 * @param {string|null|undefined} value
 */
export function setAttr(element, name, value) {
    if (!element || value == null || value === '') return;
    element.setAttribute(name, value);
}

/**
 * 从 HTML 字符串构建 DOM 元素
 * @param {string} markup
 * @returns {Element}
 */
export function buildElementFromTemplate(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    return template.content.firstElementChild;
}
