import { isLocalHost } from './local-host.ts';
import type { LeonAssets } from './leon-view.ts';

const files = ['motions.js', 'masks.js', 'math.js', 'model.js', 'skinning.js'];

function loadScript(url: URL) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url.href;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`无法加载 ${url.pathname}`)), { once: true });
    document.head.append(script);
  });
}

export async function loadLeonAssets(): Promise<LeonAssets | undefined> {
  const local = isLocalHost();
  const directory = new URL(local ? './__re9-reference/player/' : '../player/', document.baseURI);
  try {
    if (local) {
      const response = await fetch(new URL('masks.js', directory), { method: 'HEAD' });
      if (!response.ok || response.headers.get('X-RE9-Reference') !== '1') return;
    }
    await Promise.all(files.map((file) => loadScript(new URL(file, directory))));
    // Optional extra clips (Handgun00M locomotion, starts, stops, turns, angled raises and wp0100). Missing is fine.
    await loadScript(new URL('motions-extra.js', directory)).catch((error: unknown) => console.warn('里昂额外动作未加载', error));
    const { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning, MOTION_EXTRA_DATA } = window as Window & Partial<LeonAssets>;
    if (MOTION_DATA && MODEL_DATA && Array.isArray(MASK_DATA) && MotionMath && LeonSkinning) {
      return { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning, MOTION_EXTRA_DATA };
    }
  } catch (error) {
    console.warn('里昂灰模资源加载失败', error);
  }
}