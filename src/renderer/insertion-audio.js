let context;
const clips = new Map();
const urls = {
  disc: new URL('./audio/disc-insert.wav', import.meta.url),
  card: new URL('./audio/cartridge-insert.wav', import.meta.url),
};

// Call from the launch gesture so Chromium can resume audio before the animation.
export function armInsertionSound(kind) {
  let audio;
  let ready;
  try {
    audio = context ??= new AudioContext();
    const resumed = audio.state === 'running' ? Promise.resolve() : audio.resume();
    if (!clips.has(kind)) {
      clips.set(kind, fetch(urls[kind]).then((response) => {
        if (!response.ok) throw new Error('Insertion sound unavailable');
        return response.arrayBuffer();
      }).then((bytes) => audio.decodeAudioData(bytes)).catch(() => {
        clips.delete(kind);
        return null;
      }));
    }
    ready = Promise.all([resumed, clips.get(kind)]).then(([, clip]) => clip).catch(() => null);
  } catch {
    return () => {};
  }

  return () => {
    void ready.then((clip) => {
      if (!clip || audio.state !== 'running') return;
      const source = audio.createBufferSource();
      source.buffer = clip;
      source.connect(audio.destination);
      source.start();
    }).catch(() => {});
  };
}
