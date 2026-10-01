// =================== 冻结层内 CSS / WAAPI 动画 ===================
// 用于全屏 overlay（介绍弹层、升级、时间到）盖住动态内容时，避免 backdrop-filter 每帧读回。

const frozenAnimations = new WeakMap();

function isSkippedTarget(target, skipRoot) {
    if (!skipRoot || !(target instanceof Node)) return false;
    return skipRoot === target || skipRoot.contains(target);
}

/**
 * 暂停 root 子树内正在播放的 CSS Animation / Transition / WAAPI。
 * @param {Element | null | undefined} root
 * @param {{ skip?: Element | null }} [options] - 跳过该节点子树（如升级 / 时间到浮层自身）
 */
export function freezeLayerAnimations(root, { skip = null } = {}) {
    if (!(root instanceof Element) || frozenAnimations.has(root)) return;
    if (typeof root.getAnimations !== 'function') {
        frozenAnimations.set(root, []);
        return;
    }

    const animations = root.getAnimations({ subtree: true });
    const paused = [];
    for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        const target = animation.effect?.target;
        if (isSkippedTarget(target, skip)) continue;
        if (animation.playState !== 'running' && animation.playState !== 'pending') continue;
        try {
            animation.pause();
            paused.push(animation);
        } catch (_error) {
            // 个别动画在 DOM 拆卸过程中 pause 会抛错，忽略即可
        }
    }
    frozenAnimations.set(root, paused);
}

export function isLayerAnimationsFrozen(root) {
    return root instanceof Element && frozenAnimations.has(root);
}

/**
 * 恢复 freezeLayerAnimations 暂停过的动画。
 * @param {Element | null | undefined} root
 */
export function unfreezeLayerAnimations(root) {
    if (!(root instanceof Element)) return;
    const paused = frozenAnimations.get(root);
    if (!paused) return;
    for (let i = 0; i < paused.length; i++) {
        try {
            if (paused[i].playState === 'paused') paused[i].play();
        } catch (_error) {
            // 节点可能已销毁
        }
    }
    frozenAnimations.delete(root);
}
