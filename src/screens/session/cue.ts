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

/* ----------------------------------------------------------- notifications */

/**
 * Older `NotificationOptions` extras that the current DOM lib has dropped but
 * Android Chrome still honours. Declared locally rather than cast away.
 */
type RestNotificationOptions = NotificationOptions & {
  renotify?: boolean;
  vibrate?: number[];
};

function notificationsGranted(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/**
 * Ask for notification permission, but only when the browser has not already
 * decided. Must be called from inside a user gesture (the "done" tap).
 */
export function requestNotifyPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  try {
    void Notification.requestPermission().catch(() => undefined);
  } catch {
    /* Safari < 16 used the callback form; not worth a shim */
  }
}

/**
 * "Rest over" notification for the case the phone is in a pocket or another
 * app is in front — the only cue that reaches you when the tab is hidden and
 * its audio context is suspended. Silent when the app is on screen: the bar
 * and the beep already say it.
 */
export async function notifyRestOver(exerciseName: string): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  if (!notificationsGranted()) return;

  const options: RestNotificationOptions = {
    body: exerciseName ? `Next set: ${exerciseName}` : 'Next set',
    tag: 'rest-timer',
    renotify: true,
    vibrate: [200, 100, 200],
  };

  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) {
      await registration.showNotification('Rest over', options);
      return;
    }
  } catch {
    /* no service worker (dev server, private mode) — fall through */
  }

  try {
    new Notification('Rest over', options);
  } catch {
    /* some browsers only allow the service-worker form */
  }
}
