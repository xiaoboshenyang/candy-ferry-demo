import {getSharedAssetUrl} from './shared-assets.js';
import {getGameAudioContext} from '../audio/game-audio-context.js';
const cache=new Map(),pending=new Map();
export const ResourceLoader={getGameAssetAudioBuffer:(_,id)=>cache.get(id),getGameAssetUrl:(_,id)=>getSharedAssetUrl(id),async loadGameAsset(_,id){if(cache.has(id))return {audioBuffer:cache.get(id)};if(!pending.has(id))pending.set(id,(async()=>{const response=await fetch(getSharedAssetUrl(id));if(!response.ok)throw Error('本地音频缺失：'+id);const ctx=getGameAudioContext();const audioBuffer=await ctx.decodeAudioData(await response.arrayBuffer());cache.set(id,audioBuffer);return {audioBuffer};})());return pending.get(id);}};
