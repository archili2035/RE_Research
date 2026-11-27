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
    const { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning } = window as Window & Partial<LeonAssets>;
    if (MOTION_DATA && MODEL_DATA && Array.isArray(MASK_DATA) && MotionMath && LeonSkinning) {
      return { MOTION_DATA, MODEL_DATA, MASK_DATA, MotionMath, LeonSkinning };
    }
  } catch (error) {
    console.warn('里昂灰模资源加载失败', error);
  }
}
