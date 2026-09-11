/**
 * The end-of-rest cue: a short double beep plus a vibration.
 *
 * Browsers only allow audio that was unlocked by a user gesture, so the
 * AudioContext is created lazily by `primeAudio()` — called synchronously from
 * the "done" tap that starts the rest — and reused for every later beep.
 */

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Call from inside a user gesture so the beep is allowed to play later. */
export function primeAudio(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

function blip(ctx: AudioContext, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  // Ramp in and out so it clicks softly rather than popping.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.14);
}

/** Two 880 Hz blips + a vibration pattern. Safe to call when either is absent. */
export function playRestDoneCue(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* vibration is a nicety */
  }

  const ctx = context;
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const at = ctx.currentTime + 0.02;
    blip(ctx, at);
    blip(ctx, at + 0.2);
  } catch {
    /* audio is a nicety too */
  }
}
