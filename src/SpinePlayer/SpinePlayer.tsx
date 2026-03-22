import React, { useEffect, useId, useRef } from 'react';
import { Application, Assets } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8'; // Official v8 runtime
import { DRAGGABLE_LAYOUT_MEASURE_SELECTOR } from '../DraggableArea/DraggableArea';
import styles from './SpinePlayer.module.scss';

interface Props {
  skeletonUrl: string; // e.g., 'assets/hero.skel' (Binary is faster for v8)
  atlasUrl: string; // e.g., 'assets/hero.atlas'
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

export const Pixi8SpinePlayer: React.FC<Props> = ({
  skeletonUrl,
  atlasUrl,
  animation,
  layoutResetToken = 0,
  onAnimationsLoaded,
}) => {
  const loadId = useId().replace(/:/g, '');
  const skelAlias = `spineSkeleton_${loadId}`;
  const atlasAlias = `spineAtlas_${loadId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spineRef = useRef<Spine | null>(null);
  const onAnimationsLoadedRef = useRef(onAnimationsLoaded);

  useEffect(() => {
    onAnimationsLoadedRef.current = onAnimationsLoaded;
  }, [onAnimationsLoaded]);

  useEffect(() => {
    let cancelled = false;

    const initPixi = async () => {
      if (!containerRef.current) return;

      // Wait for flex layout so clientWidth/Height are non-zero, then freeze size (no resizeTo).
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (cancelled || !containerRef.current) return;

      const host = containerRef.current;
      const layoutEl = getLayoutElement(host);
      const width = Math.max(1, Math.floor(layoutEl.clientWidth));
      const height = Math.max(1, Math.floor(layoutEl.clientHeight));

      // 1. New Pixi 8 App Initialization — fixed resolution; browser resize does not resize the canvas.
      const app = new Application();
      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        preference: 'webgpu', // Pixi 8 will try WebGPU first, then WebGL
      });

      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      appRef.current = app;
      containerRef.current.appendChild(app.canvas);

      // 2. Loading Assets in v8
      // We manually add the assets to the manifest
      Assets.add({ alias: skelAlias, src: skeletonUrl });
      Assets.add({ alias: atlasAlias, src: atlasUrl });

      await Assets.load([skelAlias, atlasAlias]);

      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        appRef.current = null;
        return;
      }

      // Spine.from looks up raw skeleton + atlas via Assets.get(alias); do not pass spineData objects.
      const spine = Spine.from({
        skeleton: skelAlias,
        atlas: atlasAlias,
      });

      spineRef.current = spine;
      spine.position.set(app.screen.width / 2, app.screen.height / 2);
      spine.state.setAnimation(0, animation, true);

      const names = spine.skeleton.data.animations.map((a) => a.name);
      onAnimationsLoadedRef.current?.(names);

      app.stage.addChild(spine);
    };

    initPixi();

    return () => {
      cancelled = true;
      spineRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, [skeletonUrl, atlasUrl]);

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
    };

    frame = requestAnimationFrame(() => {
      requestAnimationFrame(applySizeFromLayout);
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutResetToken]);

  useEffect(() => {
    const spine = spineRef.current;
    if (!spine) return;
    spine.state.setAnimation(0, animation, true);
  }, [animation]);

  return <div ref={containerRef} className={styles.host} />;
};
