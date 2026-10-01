export function resolveMode(mode='full') {
  if(!['full','playtest'].includes(mode))throw Error('mode只能是full或playtest');
  return mode;
}
export function validateConfig(config,mode='full') {
  const fields=resolveMode(mode)==='playtest'?['title']:['title','ability','oneLine'];
  for(const key of fields)if(typeof config[key]!=='string'||!config[key].trim())throw Error('必填单一文字字段：'+key);
  if(mode==='full'&&(!Array.isArray(config.principles)||config.principles.length!==3))throw Error('principles必须恰好三段');
}
export function entryFor(mode,replay=false){return resolveMode(mode)==='playtest'?'game':replay?'countdown-game':'countdown-tutorial';}
