export function createBackgroundAudio(source) {
  const track = new Audio(source); track.loop = true; track.preload = 'none'; track.volume = 0.25;
  let unlocked = false, muted = false, state = 'loading', unavailable = false;
  function sync() {
    if (unlocked && !muted && state === 'game' && !unavailable) track.play().catch(() => {});
    else track.pause();
  }
  const unlock = () => { unlocked = true; sync(); };
  document.addEventListener('pointerdown', unlock, {capture:true});
  document.addEventListener('keydown', unlock, {capture:true});
  track.addEventListener('error', () => { unavailable = true; });
  return {
    setState(next) { state = next; sync(); },
    setMuted(value) { muted = Boolean(value); sync(); return muted; },
    reset() { track.pause(); track.currentTime = 0; sync(); },
    snapshot: () => ({muted, unlocked, paused: track.paused, state, unavailable}),
    destroy() { track.pause(); document.removeEventListener('pointerdown',unlock,{capture:true}); document.removeEventListener('keydown',unlock,{capture:true}); }
  };
}
