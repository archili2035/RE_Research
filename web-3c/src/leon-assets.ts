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
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
  const directory = new URL(local ? './__re9-reference/player/' : '../player/', document.baseURI);
  try {
    if (local) {
      const response = await fetch(new URL('masks.js', directory), { method: 'HEAD' });
      if (!response.ok || response.headers.get('X-RE9-Reference') !== '1') return;
    }
    await Promise.all(files.map((file) => loadScript(new URL(file, directory))));
    if (local) {
      // Optional carry-gun and turn clips. A 204 means the local export has not been run.
      const extra = new URL('motions-extra.js', directory);
      const probe = await fetch(extra, { method: 'HEAD' }).catch(() => undefined);
      if (probe?.status === 200) await loadScript(extra).catch((error: unknown) => console.warn('里昂额外动作加载失败', error));
    }
    const { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning, MOTION_EXTRA_DATA } = window as Window & Partial<LeonAssets>;
    if (MOTION_DATA && MODEL_DATA && Array.isArray(MASK_DATA) && MotionMath && LeonSkinning) {
      return { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning, MOTION_EXTRA_DATA };
    }
  } catch (error) {
    console.warn('里昂灰模资源加载失败', error);
  }
}