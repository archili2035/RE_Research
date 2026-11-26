import { CONTRACT_VERSION } from './contracts.ts';
import type { ClipManifest } from './contracts.ts';

export async function loadClipManifest(manifestUrl: URL): Promise<ClipManifest> {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`无法读取 ClipManifest（HTTP ${response.status}）`);
  const manifest = await response.json() as ClipManifest;
  if (!manifest || manifest.version !== CONTRACT_VERSION ||
      !Array.isArray(manifest.clips) || manifest.clips.length === 0) {
    throw new Error('ClipManifest 版本或内容无效');
  }

  const ids = new Set<string>();
  for (const entry of manifest.clips) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
        typeof entry.glb !== 'string' || !entry.glb || !Number.isFinite(entry.durationS) ||
        entry.durationS <= 0 || !['normal', 'additive', 'baked'].includes(entry.blend)) {
      throw new Error(`ClipManifest 的动作条目无效：${entry?.id}`);
    }
    ids.add(entry.id);
  }
  return manifest;
}
