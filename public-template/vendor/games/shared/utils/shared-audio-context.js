const localAudioContextMap = new Map();
const cachedAudioContextMap = new Map();

function getKeepworkAudioEngine() {
  if (typeof window === 'undefined') return null;

  if (window.keepwork?.audioEngine) {
    return window.keepwork.audioEngine;
  }

  if (window.AudioEngine?.getShared) {
    try {
      return window.AudioEngine.getShared();
    } catch (_) {
      return null;
    }
  }

  return null;
}

function rememberAudioContext(key, context) {
  if (!context || context.state === 'closed') {
    cachedAudioContextMap.delete(key);
    return null;
  }

  cachedAudioContextMap.set(key, context);
  return context;
}

export function getCachedSharedAudioContext(key = 'default') {
  const cachedContext = cachedAudioContextMap.get(key);
  if (cachedContext && cachedContext.state !== 'closed') {
    return cachedContext;
  }

  const localContext = localAudioContextMap.get(key);
  if (localContext && localContext.state !== 'closed') {
    return rememberAudioContext(key, localContext);
  }

  cachedAudioContextMap.delete(key);
  localAudioContextMap.delete(key);
  return null;
}

export function getSharedAudioContext({ key = 'default', resume = false, logPrefix = '[SharedAudioContext]' } = {}) {
  const cachedContext = getCachedSharedAudioContext(key);
  if (cachedContext) {
    if (resume && cachedContext.state === 'suspended') {
      try {
        cachedContext.resume();
      } catch (_) {}
    }
    return rememberAudioContext(key, cachedContext);
  }

  const keepworkAudioEngine = getKeepworkAudioEngine();
  if (keepworkAudioEngine?.getContext) {
    try {
      if (resume && keepworkAudioEngine.resume) keepworkAudioEngine.resume();
      const sharedContext = keepworkAudioEngine.getContext();
      return rememberAudioContext(key, sharedContext);
    } catch (error) {
      console.warn(`${logPrefix} 复用 Keepwork AudioContext 失败，回退本地上下文:`, error);
    }
  }

  let localContext = localAudioContextMap.get(key);
  if (!localContext || localContext.state === 'closed') {
    const AudioContextCtor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;

    if (typeof AudioContextCtor !== 'function') {
      return null;
    }

    try {
      localContext = new AudioContextCtor();
      localAudioContextMap.set(key, localContext);
    } catch (error) {
      console.warn(`${logPrefix} 创建 AudioContext 失败:`, error);
      return null;
    }
  }

  if (resume && localContext.state === 'suspended') {
    try {
      localContext.resume();
    } catch (_) {}
  }

  return rememberAudioContext(key, localContext);
}

export function withSharedAudioContext(callback, options = {}) {
  const { logPrefix = '[SharedAudioContext]' } = options;

  try {
    const context = getSharedAudioContext(options);
    if (!context) return null;
    return callback(context);
  } catch (error) {
    console.warn(`${logPrefix} AudioContext 回调执行失败:`, error);
    return null;
  }
}