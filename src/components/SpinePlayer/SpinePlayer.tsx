import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  AtlasAttachmentLoader,
  Physics,
  SkeletonBinary,
  SkeletonJson,
  TextureAtlas,
} from '@esotericsoftware/spine-core';
import { Application, Assets, Cache, Texture } from 'pixi.js';
import { Spine, SpineTexture } from '@esotericsoftware/spine-pixi-v8'; // Official v8 runtime
import {
  SPINE_ANIMATION_SPEED_STEP,
  SPINE_VIEW_SCALE_MAX,
  SPINE_VIEW_SCALE_MIN,
} from '../../utils/spineViewScale';
import styles from './SpinePlayer.module.scss';

const SPINE_DATA_SCALE = 1;

/** Spine is time-based; we derive a frame index for display at this reference rate (common editor default). */
export const SPINE_FRAME_COUNTER_FPS = 30;

export type SpineAnimationFrameInfo = { current: number; total: number };

export type Pixi8SpinePlayerHandle = {
  /** Seek track 0 to `normalized` ∈ [0, 1] along the active clip (by duration). */
  seekTrack0ToNormalized: (normalized: number) => void;
};

/** Apply pose immediately after changing {@link TrackEntry#trackTime}. */
function seekSpineTrack0ToNormalized(spine: Spine, normalized: number) {
  const track = spine.state.tracks[0];
  if (!track?.animation) return;
  const duration = track.animationEnd - track.animationStart;
  if (duration <= 0) return;
  const u = Math.max(0, Math.min(1, normalized));
  const local =
    u >= 1 ? Math.max(0, duration - 1e-5) : u * duration;
  if (track.loop) {
    track.trackTime = local % duration;
  } else {
    track.trackTime = Math.min(local, duration);
  }
  track.animationLast = -1;
  spine.state.apply(spine.skeleton);
  spine.skeleton.updateWorldTransform(Physics.update);
}

/** Host or ancestor with this attribute supplies layout size for Pixi init / resize. */
const LAYOUT_MEASURE_SELECTOR = '[data-layout-measure]';

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
  /** playing = advance; paused = frozen; stopped = frozen at first frame of current clip (like pause + rewind). */
  playbackTransport: SpinePlaybackTransport;
  /** When playing or paused, whether track 0 loops. */
  animationLoop: boolean;
  /** Bump to force restarting the current clip (Play restart, Stop, load). Not used for pause → resume. */
  playbackNonce: number;
  /** Multiplier for {@link AnimationState#timeScale} while transport is playing (1 = normal). */
  animationSpeed: number;
  /** Uniform scale of the Spine inside the canvas (does not resize the canvas element). */
  spineScale: number;
  /** Increment to remeasure renderer, reset pan, and reapply {@link spineScale}. */
  layoutResetToken?: number;
  /** Fired once the skeleton is built; names come from {@link SkeletonData#animations}. */
  onAnimationsLoaded?: (animationNames: string[]) => void;
  /** Current / total display frames from track 0 (30 samples per second of clip duration); `null` when no clip on track 0. */
  onAnimationFrames?: (info: SpineAnimationFrameInfo | null) => void;
  /** Track 0 position ∈ [0, 1] by duration; emitted on the Pixi ticker when track 0 has a clip. */
  onAnimationProgressNormalized?: (normalized: number) => void;
  /** Wheel over canvas: positive delta zooms in, negative zooms out (caller should clamp). */
  onSpineScaleDelta?: (delta: number) => void;
  /** Shift + wheel over canvas: delta adjusts playback speed like the slider (caller clamps). */
  onAnimationSpeedDelta?: (delta: number) => void;
}

function getLayoutElement(host: HTMLElement): HTMLElement {
  return (
    host.closest(LAYOUT_MEASURE_SELECTOR) ?? host.parentElement ?? host
  );
}

/** Prefer `preferred` if it exists on the skeleton; otherwise first clip; avoids invalid setAnimation. */
function pickAnimationToPlay(spine: Spine, preferred: string): string | null {
  const names = spine.skeleton.data.animations.map((a) => a.name);
  if (names.length === 0) return null;
  if (preferred && names.includes(preferred)) return preferred;
  return names[0] ?? null;
}

export type SpinePlaybackTransport = 'playing' | 'paused' | 'stopped';

/**
 * Apply clip + transport. Uses {@link playbackNonce} so Play-while-playing restarts without
 * breaking pause → resume (same nonce).
 */
function applySpinePlayback(
  spine: Spine,
  preferred: string,
  transport: SpinePlaybackTransport,
  animationLoop: boolean,
  playbackNonce: number,
  animationSpeed: number,
  lastNonceRef: { current: number | null },
) {
  const name = pickAnimationToPlay(spine, preferred);
  if (transport === 'stopped') {
    if (!name) {
      console.warn('[SpinePlayer] stop skipped: no clips on skeleton', { preferred });
      return;
    }
    const trackBefore = spine.state.tracks[0];
    const mismatched =
      !trackBefore?.animation || trackBefore.animation.name !== name;
    const nonceRestart =
      lastNonceRef.current !== null && lastNonceRef.current !== playbackNonce;
    if (mismatched || nonceRestart) {
      spine.state.setAnimation(0, name, animationLoop);
    } else {
      const t0 = spine.state.tracks[0];
      if (t0) t0.loop = animationLoop;
    }
    const t = spine.state.tracks[0];
    if (t) {
      t.trackTime = 0;
      t.animationLast = -1;
    }
    spine.state.timeScale = 0;
    spine.state.apply(spine.skeleton);
    spine.skeleton.updateWorldTransform(Physics.update);
    lastNonceRef.current = playbackNonce;
    console.log('[SpinePlayer] playback stop (pause at first frame)');
    return;
  }

  if (!name) {
    console.warn('[SpinePlayer] setAnimation skipped: no clips on skeleton', { preferred });
    return;
  }

  const track = spine.state.tracks[0];
  const mismatched = !track?.animation || track.animation.name !== name;
  const nonceRestart =
    lastNonceRef.current !== null && lastNonceRef.current !== playbackNonce;
  const shouldSetAnim = mismatched || nonceRestart;

  if (shouldSetAnim) {
    console.log('[SpinePlayer] setAnimation track 0', {
      preferred: preferred || '(none)',
      resolved: name,
      loop: animationLoop,
      transport,
    });
    spine.state.setAnimation(0, name, animationLoop);
  } else {
    const t = spine.state.tracks[0];
    if (t) t.loop = animationLoop;
  }

  lastNonceRef.current = playbackNonce;
  spine.state.timeScale = transport === 'playing' ? animationSpeed : 0;
}

export const Pixi8SpinePlayer = forwardRef<Pixi8SpinePlayerHandle, Props>(
  function Pixi8SpinePlayer(
    {
      skeletonUrl,
      atlasUrl,
      atlasImageMap,
      animation,
      playbackTransport,
      animationLoop,
      playbackNonce,
      animationSpeed,
      spineScale,
      layoutResetToken = 0,
      onAnimationsLoaded,
      onAnimationFrames,
      onAnimationProgressNormalized,
      onSpineScaleDelta,
      onAnimationSpeedDelta,
    },
    ref,
  ) {
  /** Disambiguate multiple player instances; aliases also get a per-load seq (see loadSeqRef). */
  const loadId = useId().replace(/:/g, '');
  const loadSeqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spineRef = useRef<Spine | null>(null);
  const spineScaleRef = useRef(spineScale);
  const panRef = useRef({ x: 0, y: 0 });
  const applyViewRef = useRef<() => void>(() => {});
  const onAnimationsLoadedRef = useRef(onAnimationsLoaded);
  const onAnimationFramesRef = useRef(onAnimationFrames);
  const onAnimationProgressNormalizedRef = useRef(onAnimationProgressNormalized);
  const onSpineScaleDeltaRef = useRef(onSpineScaleDelta);
  const onAnimationSpeedDeltaRef = useRef(onAnimationSpeedDelta);
  const playbackTransportRef = useRef(playbackTransport);
  const lastPlaybackNonceRef = useRef<number | null>(null);

  const applySpineViewTransform = useCallback(() => {
    const app = appRef.current;
    const spine = spineRef.current;
    const host = containerRef.current;
    if (!app || !spine || !host) return;
    const layoutEl = getLayoutElement(host);
    const width = Math.max(1, Math.floor(layoutEl.clientWidth));
    const height = Math.max(1, Math.floor(layoutEl.clientHeight));
    const s = spineScaleRef.current;
    spine.scale.set(s, s);
    spine.position.set(width / 2 + panRef.current.x, height / 2 + panRef.current.y);
  }, []);

  useLayoutEffect(() => {
    spineScaleRef.current = spineScale;
    applyViewRef.current = applySpineViewTransform;
    applySpineViewTransform();
  }, [spineScale, applySpineViewTransform]);

  useEffect(() => {
    onAnimationsLoadedRef.current = onAnimationsLoaded;
  }, [onAnimationsLoaded]);

  useEffect(() => {
    onAnimationFramesRef.current = onAnimationFrames;
  }, [onAnimationFrames]);

  useEffect(() => {
    onAnimationProgressNormalizedRef.current = onAnimationProgressNormalized;
  }, [onAnimationProgressNormalized]);

  useEffect(() => {
    playbackTransportRef.current = playbackTransport;
  }, [playbackTransport]);

  useImperativeHandle(ref, () => ({
    seekTrack0ToNormalized: (normalized: number) => {
      const spine = spineRef.current;
      if (!spine) return;
      seekSpineTrack0ToNormalized(spine, normalized);
    },
  }));

  useEffect(() => {
    onSpineScaleDeltaRef.current = onSpineScaleDelta;
  }, [onSpineScaleDelta]);

  useEffect(() => {
    onAnimationSpeedDeltaRef.current = onAnimationSpeedDelta;
  }, [onAnimationSpeedDelta]);

  useEffect(() => {
    let cancelled = false;
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    const skelAlias = `spineSkel_${loadId}_${seq}`;
    const atlasAlias = `spineAtlas_${loadId}_${seq}`;
    let registeredPixiAssetAliases = false;
    let detachCanvasPointers: (() => void) | undefined;
    let detachWheel: (() => void) | undefined;
    let detachFrameTicker: (() => void) | undefined;

    const initPixi = async () => {
      if (!containerRef.current) return;

      panRef.current = { x: 0, y: 0 };

      console.log('[SpinePlayer] init start', {
        skelAlias,
        atlasAlias,
        skeletonUrl: skeletonUrl.slice(0, 80),
        atlasUrl: atlasUrl.slice(0, 80),
        blobAtlas: !!(atlasImageMap && Object.keys(atlasImageMap).length),
      });

      // Wait for flex layout so clientWidth/Height are non-zero before first init.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (cancelled || !containerRef.current) return;

      const host = containerRef.current;
      const layoutEl = getLayoutElement(host);
      const width = Math.max(1, Math.floor(layoutEl.clientWidth));
      const height = Math.max(1, Math.floor(layoutEl.clientHeight));
      console.log('[SpinePlayer] layout measure', { width, height });

      // 1. Pixi Application — initial size from layout; ResizeObserver keeps canvas in sync later.
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
      applySpinePlayback(
        spine,
        animation,
        playbackTransport,
        animationLoop,
        playbackNonce,
        animationSpeed,
        lastPlaybackNonceRef,
      );

      const names = spine.skeleton.data.animations.map((a) => a.name);
      console.log('[SpinePlayer] notify onAnimationsLoaded', names);
      onAnimationsLoadedRef.current?.(names);

      app.stage.addChild(spine);

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'grab';

      const drag = {
        active: false,
        pointerId: -1,
        startClientX: 0,
        startClientY: 0,
        panStart: { x: 0, y: 0 },
      };

      /** Active pointers on the canvas (for two-finger pinch on touch). */
      const activePointers = new Map<
        number,
        { clientX: number; clientY: number }
      >();

      let pinch: null | { startDist: number; anchorScale: number } = null;

      const setGrabCursor = (grabbing: boolean) => {
        canvas.style.cursor = grabbing ? 'grabbing' : 'grab';
      };

      const twoPointerDistance = (): number | null => {
        if (activePointers.size < 2) return null;
        const pts = [...activePointers.values()];
        const dx = pts[0].clientX - pts[1].clientX;
        const dy = pts[0].clientY - pts[1].clientY;
        return Math.hypot(dx, dy);
      };

      const releaseDragCapture = () => {
        if (!drag.active) return;
        drag.active = false;
        setGrabCursor(false);
        try {
          canvas.releasePointerCapture(drag.pointerId);
        } catch {
          /* already released */
        }
      };

      const beginSingleFingerPan = (e: PointerEvent) => {
        drag.active = true;
        drag.pointerId = e.pointerId;
        drag.startClientX = e.clientX;
        drag.startClientY = e.clientY;
        drag.panStart = { ...panRef.current };
        setGrabCursor(true);
        canvas.setPointerCapture(e.pointerId);
      };

      const maybeResumePanAfterPinch = () => {
        if (activePointers.size !== 1) return;
        const [pid, pt] = [...activePointers.entries()][0];
        drag.active = true;
        drag.pointerId = pid;
        drag.startClientX = pt.clientX;
        drag.startClientY = pt.clientY;
        drag.panStart = { ...panRef.current };
        setGrabCursor(true);
        canvas.setPointerCapture(pid);
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        activePointers.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
        });

        if (activePointers.size >= 2) {
          releaseDragCapture();
          const d = twoPointerDistance();
          if (d != null && d > 8) {
            pinch = {
              startDist: Math.max(d, 1e-3),
              anchorScale: spineScaleRef.current,
            };
          }
          return;
        }

        if (activePointers.size === 1) {
          beginSingleFingerPan(e);
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
        });

        if (activePointers.size >= 2) {
          if (pinch == null) {
            const d0 = twoPointerDistance();
            if (d0 != null && d0 > 8) {
              releaseDragCapture();
              pinch = {
                startDist: Math.max(d0, 1e-3),
                anchorScale: spineScaleRef.current,
              };
            }
          }
          if (pinch != null) {
            const d = twoPointerDistance();
            if (d == null || d < 1e-3) return;
            const scaleFn = onSpineScaleDeltaRef.current;
            if (!scaleFn) return;
            const targetRaw =
              pinch.anchorScale * (d / pinch.startDist);
            const target = Math.min(
              SPINE_VIEW_SCALE_MAX,
              Math.max(SPINE_VIEW_SCALE_MIN, targetRaw),
            );
            const current = spineScaleRef.current;
            const delta = target - current;
            if (Math.abs(delta) > 1e-5) {
              scaleFn(delta);
              spineScaleRef.current = target;
            }
          }
          return;
        }

        if (!drag.active || e.pointerId !== drag.pointerId) return;
        panRef.current.x =
          drag.panStart.x + (e.clientX - drag.startClientX);
        panRef.current.y =
          drag.panStart.y + (e.clientY - drag.startClientY);
        applyViewRef.current();
      };

      const onPointerUpOrCancel = (e: PointerEvent) => {
        const wasPinching = pinch != null && activePointers.size >= 2;
        activePointers.delete(e.pointerId);

        if (activePointers.size < 2) {
          pinch = null;
        }

        if (drag.active && e.pointerId === drag.pointerId) {
          releaseDragCapture();
        }

        if (wasPinching && activePointers.size === 1) {
          maybeResumePanAfterPinch();
        }
      };

      const onLostPointerCapture = (e: PointerEvent) => {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) pinch = null;
        drag.active = false;
        setGrabCursor(false);
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUpOrCancel);
      canvas.addEventListener('pointercancel', onPointerUpOrCancel);
      canvas.addEventListener('lostpointercapture', onLostPointerCapture);

      const WHEEL_SCALE_STEP = 0.06;
      const onWheel = (e: WheelEvent) => {
        if (e.shiftKey) {
          const speedFn = onAnimationSpeedDeltaRef.current;
          if (!speedFn) return;
          // Shift+wheel often maps vertical motion to deltaX; deltaY can stay 0 (was always “slower”).
          const delta =
            Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (delta === 0) return;
          e.preventDefault();
          const direction = delta < 0 ? 1 : -1;
          const magnitude = Math.min(3, 1 + Math.abs(delta) / 100);
          speedFn(direction * SPINE_ANIMATION_SPEED_STEP * magnitude);
          return;
        }
        const scaleFn = onSpineScaleDeltaRef.current;
        if (!scaleFn) return;
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : -1;
        const magnitude = Math.min(3, 1 + Math.abs(e.deltaY) / 100);
        scaleFn(direction * WHEEL_SCALE_STEP * magnitude);
      };

      canvas.addEventListener('wheel', onWheel, { passive: false });

      detachCanvasPointers = () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUpOrCancel);
        canvas.removeEventListener('pointercancel', onPointerUpOrCancel);
        canvas.removeEventListener('lostpointercapture', onLostPointerCapture);
      };

      detachWheel = () => {
        canvas.removeEventListener('wheel', onWheel);
      };

      applyViewRef.current();
      console.log(
        '[SpinePlayer] spine added to stage; pointer pan, pinch scale (2 touches), wheel scale',
      );

      let lastFrameEmitKey = '';
      const onFramesTick = () => {
        const framesCb = onAnimationFramesRef.current;
        const progressCb = onAnimationProgressNormalizedRef.current;
        if (!framesCb && !progressCb) return;
        const spineNow = spineRef.current;
        if (!spineNow) return;
        const track = spineNow.state.tracks[0];
        if (!track?.animation) {
          if (framesCb && lastFrameEmitKey !== '—') {
            lastFrameEmitKey = '—';
            framesCb(null);
          }
          progressCb?.(0);
          return;
        }
        const duration = track.animationEnd - track.animationStart;
        if (duration <= 0) {
          if (framesCb) {
            const key = '1/1';
            if (key !== lastFrameEmitKey) {
              lastFrameEmitKey = key;
              framesCb({ current: 1, total: 1 });
            }
          }
          progressCb?.(0);
          return;
        }
        const local = Math.max(0, track.getAnimationTime() - track.animationStart);
        if (framesCb) {
          const total = Math.max(1, Math.ceil(duration * SPINE_FRAME_COUNTER_FPS));
          const idx0 = Math.floor(local * SPINE_FRAME_COUNTER_FPS);
          const current = Math.min(Math.max(1, idx0 + 1), total);
          const key = `${current}/${total}`;
          if (key !== lastFrameEmitKey) {
            lastFrameEmitKey = key;
            framesCb({ current, total });
          }
        }
        progressCb?.(Math.min(1, local / duration));
      };
      app.ticker.add(onFramesTick);
      detachFrameTicker = () => {
        app.ticker.remove(onFramesTick);
      };
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
      detachCanvasPointers?.();
      detachWheel?.();
      detachFrameTicker?.();
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
    // playback: applied in dedicated effect; init uses closure transport (first paint)
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

      panRef.current = { x: 0, y: 0 };
      app.renderer.resize(width, height);
      applyViewRef.current();
      console.log('[SpinePlayer] layout reset: resize + pan cleared + spine transform', {
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
      console.log('[SpinePlayer] playback/animation but spine not ready yet', {
        animation,
        playbackTransport,
        playbackNonce,
      });
      return;
    }
    applySpinePlayback(
      spine,
      animation,
      playbackTransport,
      animationLoop,
      playbackNonce,
      animationSpeed,
      lastPlaybackNonceRef,
    );
  }, [animation, playbackTransport, animationLoop, playbackNonce, animationSpeed]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const layoutEl = getLayoutElement(host);

    let raf = 0;
    const resizeToLayout = () => {
      const app = appRef.current;
      if (!app) return;
      const w = Math.max(1, Math.floor(layoutEl.clientWidth));
      const h = Math.max(1, Math.floor(layoutEl.clientHeight));
      app.renderer.resize(w, h);
      applyViewRef.current();
    };

    const scheduleResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        resizeToLayout();
      });
    };

    const ro = new ResizeObserver(scheduleResize);
    ro.observe(layoutEl);
    scheduleResize();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <div ref={containerRef} className={styles.host} />;
});

Pixi8SpinePlayer.displayName = 'Pixi8SpinePlayer';
