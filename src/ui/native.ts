import { Capacitor, SystemBars } from '@capacitor/core';
import { backTarget } from '../lib/nav';

/**
 * Inside the Android app, the system back gesture (swipe from the screen edge) or button follows
 * `backTarget`: to "Your decks" from any other screen, the Life Counter game included (it is that tab's
 * only screen), and out of the app only from there. Browsers keep their own back.
 */
export async function installNativeBack(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    const open = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (open) {
      open.close();
      return;
    }
    const target = backTarget(location.hash);
    if (target) location.replace(target);
    else void App.exitApp();
  });
}

/**
 * One short buzz, where the platform offers it (`navigator.vibrate`: Android Chrome and the Android app's WebView; not iOS).
 * It does nothing under reduced motion, when `vibrate` is missing, or when the browser refuses; it never throws.
 */
export function buzz(ms = 80): void {
  try {
    if (typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(ms);
  } catch {
    // A blocked or broken vibrate is not worth a message.
  }
}

/**
 * Inside the Android app the Life Counter takes the whole screen and stays landscape: the status bar and gesture bar are
 * hidden (a swipe from the edge shows them for a moment), the screen turns to landscape (either side) and stays there, and
 * every other screen gets the bars and free rotation back. Browsers do nothing. It never throws.
 */
export function setImmersive(on: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  void (on ? SystemBars.hide() : SystemBars.show()).catch(() => undefined);
  try {
    (window as { SwapsmithNative?: { setLandscape(on: boolean): void } }).SwapsmithNative?.setLandscape(on);
  } catch {
    // An app build without the bridge keeps its rotation.
  }
}
