let replayStartedFromResultPage = false;
const activePageControllers = new Set();

export function markReplayStartedFromResultPage() {
    replayStartedFromResultPage = true;
    for (const controller of activePageControllers) {
        try {
            controller.destroy();
        } catch (error) {
            console.warn('[InGameHelpReplayPolicy] 清理局内指引失败', error);
        }
    }
    activePageControllers.clear();
}

export function shouldSkipInGameHelpForReplay(controller = null) {
    if (!replayStartedFromResultPage && typeof controller?.destroy === 'function') {
        activePageControllers.add(controller);
    }
    return replayStartedFromResultPage;
}