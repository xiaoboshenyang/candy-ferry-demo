const ENABLED_BOOLEAN_VALUES = new Set(['1', 'true']);

function normalizeSearchParams(input = '') {
  if (input instanceof URLSearchParams) return input;
  return new URLSearchParams(String(input || ''));
}

export function isBooleanQueryParamEnabled(input, name) {
  const params = normalizeSearchParams(input);
  const value = String(params.get(name) || '').trim().toLowerCase();
  return ENABLED_BOOLEAN_VALUES.has(value);
}

export function createRuntimeEnvironment({
  viteDev = false,
  mode = 'production',
  search = '',
} = {}) {
  const params = normalizeSearchParams(search);
  const isLocal = Boolean(viteDev);
  const isTest = !isLocal && mode === 'test';
  const devRequested = isBooleanQueryParamEnabled(params, 'dev');
  const isTestDebug = isTest && devRequested;
  const developerTools = isLocal || isTestDebug;
  const automationRequested = isBooleanQueryParamEnabled(params, 'testMode')
    || isBooleanQueryParamEnabled(params, 'test');
  const diagnosticsRequested = ['showPerf', 'debugPerf', 'diag', 'diagnostic']
    .some((name) => isBooleanQueryParamEnabled(params, name));
  const automation = (isLocal || isTest) && automationRequested;
  const diagnostics = isLocal || ((isTest || isTestDebug) && diagnosticsRequested);

  let name = 'production';
  if (isLocal) name = 'local';
  else if (isTestDebug) name = 'test-debug';
  else if (isTest) name = 'test';

  return Object.freeze({
    name,
    mode,
    isLocal,
    isTest,
    isProduction: !isLocal && !isTest,
    devRequested,
    capabilities: Object.freeze({
      developerTools,
      automation,
      diagnostics,
      runtimeOverrides: developerTools || automation,
      suppressResultReporting: automation,
      disableServiceWorker: developerTools,
      cacheMaintenance: developerTools,
    }),
  });
}

const viteEnv = import.meta.env || {};
const runtimeSearch = typeof window !== 'undefined' && typeof window.location?.search === 'string'
  ? window.location.search
  : '';

function getParentRuntimeEnvironment() {
  if (typeof window === 'undefined' || window.parent === window) return null;
  try {
    return window.parent.__silvermindRuntimeEnvironment || null;
  } catch {
    return null;
  }
}

const parentEnvironment = getParentRuntimeEnvironment();

export const RuntimeEnvironment = createRuntimeEnvironment({
  viteDev: Boolean(viteEnv.DEV) || parentEnvironment?.isLocal === true,
  mode: parentEnvironment?.isTest ? 'test' : (viteEnv.MODE || 'production'),
  search: runtimeSearch,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__silvermindRuntimeEnvironment', {
    value: RuntimeEnvironment,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
