import React, { useEffect, useId, useRef } from 'react';
import {
  AtlasAttachmentLoader,
  SkeletonBinary,
  SkeletonJson,
  TextureAtlas,
} from '@esotericsoftware/spine-core';
import { Application, Assets, Cache, Texture } from 'pixi.js';
import { Spine, SpineTexture } from '@esotericsoftware/spine-pixi-v8'; // Official v8 runtime
import { DRAGGABLE_LAYOUT_MEASURE_SELECTOR } from '../DraggableArea/DraggableArea';
import styles from './SpinePlayer.module.scss';

const SPINE_DATA_SCALE = 1;

/** Duck-type: Vite can bundle two copies of spine-core, so `instanceof TextureAtlas` may fail. */
function isLikelySpineTextureAtlas(v: unknown): v is TextureAtlas {
  if (v == null || typeof v !== 'object') return false;
  const o = v as { pages?: unknown; regions?: unknown };
  return Array.isArray(o.pages) && Array.isArray(o.regions);
}

function isLikelySpineSkeletonData(v: unknown): boolean {
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return true;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v) as { bones?: unknown };
      return Array.isArray(p.bones);
    } catch {
      return false;
    }
  }
  if (typeof v === 'object' && v !== null) {
    const o = v as { bones?: unknown };
    return Array.isArray(o.bones);
  }
  return false;
}

function describeUniqueBundleValues(loaded: Record<string, unknown>): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  for (const v of Object.values(loaded)) {
    if (v == null || seen.has(v)) continue;
    seen.add(v);
    const ctor =
      typeof v === 'object' && v !== null
        ? (v as { constructor?: { name?: string } }).constructor?.name ?? '?'
        : typeof v;
    parts.push(ctor);
  }
  return parts.join(', ');
}

/**
 * Pixi puts each logical asset under several keys (alias + resolved `src`). Concurrent inits / Strict Mode
 * can make alias keys not line up with the `loaded` object you get back, so we pick by runtime shape.
 */
function pickSkeletonAndAtlasFromBundle(loaded: Record<string, unknown>): {
  skeleton: unknown;
  atlas: TextureAtlas;
} {
  const seen = new Set<unknown>();
  let skeleton: unknown;
  let atlas: TextureAtlas | undefined;

  for (const v of Object.values(loaded)) {
    if (v == null || seen.has(v)) continue;
    seen.add(v);

    if (isLikelySpineTextureAtlas(v)) {
      atlas = v;
      continue;
    }
    if (isLikelySpineSkeletonData(v)) {
      skeleton = v;
      continue;
    }
  }

  if (skeleton == null || atlas == null) {
    throw new Error(
      `[SpinePlayer] Load bundle has no Spine skeleton + atlas. Keys: ${Object.keys(loaded).join(', ')}. Unique value types: ${describeUniqueBundleValues(loaded)}`,
    );
  }

  return { skeleton, atlas };
}

/** Same parsing as {@link Spine.from}, but uses loaded assets directly — `Assets.get(alias)` can be null after load. */
function createSpineFromLoadedAssets(
  skeletonAsset: unknown,
  atlasAsset: unknown,
  scale: number = SPINE_DATA_SCALE,
): Spine {
  const attachmentLoader = new AtlasAttachmentLoader(atlasAsset as TextureAtlas);
  let skeletonData;
  if (skeletonAsset instanceof Uint8Array || skeletonAsset instanceof ArrayBuffer) {
    const binary =
      skeletonAsset instanceof ArrayBuffer
        ? new Uint8Array(skeletonAsset)
        : skeletonAsset;
    const parser = new SkeletonBinary(attachmentLoader);
    parser.scale = scale;
    skeletonData = parser.readSkeletonData(binary);
  } else {
    const parser = new SkeletonJson(attachmentLoader);
    parser.scale = scale;
    skeletonData = parser.readSkeletonData(skeletonAsset as object | string);
  }
  return new Spine({ skeletonData, autoUpdate: true });
}

/** Blob: URLs have no `.json` suffix; detect JSON by skipping ASCII whitespace then `{`. */
function parseSkeletonFetchResponse(buf: ArrayBuffer): unknown {
  const u8 = new Uint8Array(buf);
  let i = 0;
  while (
    i < u8.length &&
    (u8[i] === 9 || u8[i] === 10 || u8[i] === 13 || u8[i] === 32)
  ) {
    i += 1;
  }
  if (i < u8.length && u8[i] === 0x7b /* { */) {
    return JSON.parse(new TextDecoder('utf-8').decode(buf));
  }
  return new Uint8Array(buf);
}

/**
 * Pixi `Assets.load` often returns keys with `undefined` values for `blob:` skeleton/atlas (loader/cache mismatch).
 * Load with `fetch` and build the atlas like spine-pixi's atlas parser.
 */
async function loadSpineBlobPack(
  skeletonUrl: string,
  atlasUrl: string,
  atlasImageMap: Record<string, string>,
): Promise<{ skeleton: unknown; atlas: TextureAtlas }> {
  const [skelRes, atlasRes] = await Promise.all([
    fetch(skeletonUrl),
    fetch(atlasUrl),
  ]);
  if (!skelRes.ok) {
    throw new Error(`[SpinePlayer] Skeleton fetch failed: HTTP ${skelRes.status}`);
  }
  if (!atlasRes.ok) {
    throw new Error(`[SpinePlayer] Atlas fetch failed: HTTP ${atlasRes.status}`);
  }

  const skeleton = parseSkeletonFetchResponse(await skelRes.arrayBuffer());
  const atlasText = await atlasRes.text();
  const atlas = new TextureAtlas(atlasText);

  for (const page of atlas.pages) {
    const imageUrl = atlasImageMap[page.name];
    if (!imageUrl) {
      throw new Error(
        `[SpinePlayer] Atlas page "${page.name}" has no image in atlasImageMap (keys: ${Object.keys(atlasImageMap).join(', ')}). The first line of the .atlas file must match your texture file name.`,
      );
    }
    const texRes = await fetch(imageUrl);
    if (!texRes.ok) {
      throw new Error(
        `[SpinePlayer] Texture "${page.name}" fetch failed: HTTP ${texRes.status}`,
      );
    }
    const bitmap = await createImageBitmap(await texRes.blob());
    const pixiTexture = Texture.from(bitmap);
    page.setTexture(SpineTexture.from(pixiTexture.source));
  }

  return { skeleton, atlas };
}

interface Props {
  skeletonUrl: string; // e.g., 'assets/hero.skel' (Binary is faster for v8)
  atlasUrl: string; // e.g., 'assets/hero.atlas'
  /** When loading from blobs, map atlas page name (first line of .atlas) → texture object URL. */
  atlasImageMap?: Record<string, string>;
  animation: string;
  /** Increment to remeasure canvas / renderer size (e.g. reset control). */
  layoutResetToken?: number;
  /** Fired once the skeleton is built; names come from {@link SkeletonData#animations}. */
  onAnimationsLoaded?: (animationNames: string[]) => void;
}

function getLayoutElement(host: HTMLElement): HTMLElement {
  return (
    host.closest(DRAGGABLE_LAYOUT_MEASURE_SELECTOR) ??
    host.parentElement ??
    host
  );
}

/** Prefer `preferred` if it exists on the skeleton; otherwise first clip; avoids invalid setAnimation. */
function pickAnimationToPlay(spine: Spine, preferred: string): string | null {
  const names = spine.skeleton.data.animations.map((a) => a.name);
  if (names.length === 0) return null;
  if (preferred && names.includes(preferred)) return preferred;
  return names[0] ?? null;
}

function applySpineAnimation(spine: Spine, preferred: string) {
  const name = pickAnimationToPlay(spine, preferred);
  if (name) {
    console.log('[SpinePlayer] setAnimation track 0', { preferred: preferred || '(none)', resolved: name });
    spine.state.setAnimation(0, name, true);
  } else {
    console.warn('[SpinePlayer] setAnimation skipped: no clips on skeleton', { preferred });
  }
}

export const Pixi8SpinePlayer: React.FC<Props> = ({
  skeletonUrl,
  atlasUrl,
  atlasImageMap,
  animation,
  layoutResetToken = 0,
  onAnimationsLoaded,
}) => {
  /** Disambiguate multiple player instances; aliases also get a per-load seq (see loadSeqRef). */
  const loadId = useId().replace(/:/g, '');
  const loadSeqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spineRef = useRef<Spine | null>(null);
  const onAnimationsLoadedRef = useRef(onAnimationsLoaded);

  useEffect(() => {
    onAnimationsLoadedRef.current = onAnimationsLoaded;
  }, [onAnimationsLoaded]);

  useEffect(() => {
    let cancelled = false;
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    const skelAlias = `spineSkel_${loadId}_${seq}`;
    const atlasAlias = `spineAtlas_${loadId}_${seq}`;
    let registeredPixiAssetAliases = false;

    const initPixi = async () => {
      if (!containerRef.current) return;

      console.log('[SpinePlayer] init start', {
        skelAlias,
        atlasAlias,
        skeletonUrl: skeletonUrl.slice(0, 80),
        atlasUrl: atlasUrl.slice(0, 80),
        blobAtlas: !!(atlasImageMap && Object.keys(atlasImageMap).length),
      });

      // Wait for flex layout so clientWidth/Height are non-zero, then freeze size (no resizeTo).
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (cancelled || !containerRef.current) return;

      const host = containerRef.current;
      const layoutEl = getLayoutElement(host);
      const width = Math.max(1, Math.floor(layoutEl.clientWidth));
      const height = Math.max(1, Math.floor(layoutEl.clientHeight));
      console.log('[SpinePlayer] layout measure', { width, height });

      // 1. New Pixi 8 App Initialization — fixed resolution; browser resize does not resize the canvas.
      const app = new Application();
      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        preference: 'webgpu', // Pixi 8 will try WebGPU first, then WebGL
      });

      if (cancelled) {
        console.log('[SpinePlayer] init aborted after app.init (cancelled)');
        app.destroy(true, { children: true, texture: true });
        return;
      }

      console.log('[SpinePlayer] Pixi Application ready', {
        renderer: app.renderer?.type,
        screen: { w: app.screen.width, h: app.screen.height },
      });

      appRef.current = app;
      containerRef.current.appendChild(app.canvas);

      // 2. Spine data: blob packs skip Pixi Assets (Assets.load often yields keys with undefined values for blob: URLs).
      const hasBlobTextures =
        atlasImageMap && Object.keys(atlasImageMap).length > 0;

      let rawSkel: unknown;
      let rawAtlas: TextureAtlas;

      if (hasBlobTextures) {
        console.log('[SpinePlayer] load spine via fetch (blob pack)');
        const pack = await loadSpineBlobPack(
          skeletonUrl,
          atlasUrl,
          atlasImageMap,
        );
        rawSkel = pack.skeleton;
        rawAtlas = pack.atlas;
      } else {
        Assets.add({ alias: skelAlias, src: skeletonUrl });
        Assets.add({ alias: atlasAlias, src: atlasUrl });
        registeredPixiAssetAliases = true;
        console.log('[SpinePlayer] Assets.add skeleton + atlas (bundled paths)');

        const loaded = (await Assets.load([skelAlias, atlasAlias])) as Record<
          string,
          unknown
        >;
        console.log('[SpinePlayer] Assets.load complete');

        const picked = pickSkeletonAndAtlasFromBundle(loaded);
        rawSkel = picked.skeleton;
        rawAtlas = picked.atlas;
      }

      if (cancelled) {
        console.log('[SpinePlayer] init aborted after spine data load (cancelled)');
        app.destroy(true, { children: true, texture: true });
        appRef.current = null;
        return;
      }

      const spine = createSpineFromLoadedAssets(rawSkel, rawAtlas, SPINE_DATA_SCALE);
      console.log('[SpinePlayer] Spine built from loaded assets OK');

      spineRef.current = spine;
      spine.autoUpdate = true;
      spine.position.set(app.screen.width / 2, app.screen.height / 2);
      applySpineAnimation(spine, animation);

      const names = spine.skeleton.data.animations.map((a) => a.name);
      console.log('[SpinePlayer] notify onAnimationsLoaded', names);
      onAnimationsLoadedRef.current?.(names);

      app.stage.addChild(spine);
      console.log('[SpinePlayer] spine added to stage; init done');
    };

    initPixi().catch((err) => {
      console.error('[SpinePlayer] init failed', err);
      spineRef.current = null;
      const app = appRef.current;
      if (app) {
        app.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    });

    return () => {
      console.log('[SpinePlayer] cleanup: destroy Pixi app', { skelAlias, atlasAlias });
      cancelled = true;
      spineRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      // Spine.from would cache SkeletonData under this key; remove if present (e.g. older runs).
      const spineDataCacheKey = `${skelAlias}-${atlasAlias}-${SPINE_DATA_SCALE}`;
      if (Cache.has(spineDataCacheKey)) {
        Cache.remove(spineDataCacheKey);
        console.log('[SpinePlayer] cleanup: removed Spine SkeletonData cache', {
          spineDataCacheKey,
        });
      }
      if (registeredPixiAssetAliases) {
        void Assets.unload([skelAlias, atlasAlias]).catch((err) => {
          console.warn('[SpinePlayer] Assets.unload', err);
        });
      }
    };
    // animation: applied in dedicated effect below (avoid full Pixi re-init on clip change)
    // skelAlias/atlasAlias: stable per mount; listed only for logging
  }, [skeletonUrl, atlasUrl, atlasImageMap]); // eslint-disable-line react-hooks/exhaustive-deps -- see above

  useEffect(() => {
    if (layoutResetToken === 0) return;

    let frame = 0;
    const applySizeFromLayout = () => {
      const app = appRef.current;
      const spine = spineRef.current;
      const host = containerRef.current;
      if (!app || !spine || !host) return;

      const layoutEl = getLayoutElement(host);
      const width = Math.max(1, Math.floor(layoutEl.clientWidth));
      const height = Math.max(1, Math.floor(layoutEl.clientHeight));

      app.renderer.resize(width, height);
      spine.position.set(width / 2, height / 2);
      console.log('[SpinePlayer] layout reset: renderer.resize + spine centered', {
        layoutResetToken,
        width,
        height,
      });
    };

    frame = requestAnimationFrame(() => {
      requestAnimationFrame(applySizeFromLayout);
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutResetToken]);

  useEffect(() => {
    const spine = spineRef.current;
    if (!spine) {
      console.log('[SpinePlayer] animation prop changed but spine not ready yet', { animation });
      return;
    }
    console.log('[SpinePlayer] animation prop → apply', { animation });
    applySpineAnimation(spine, animation);
  }, [animation]);

  return <div ref={containerRef} className={styles.host} />;
};
