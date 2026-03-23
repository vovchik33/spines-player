import React, { useRef } from "react";
import type { SpinePlaybackTransport } from "../SpinePlayer/SpinePlayer";
import {
  SPINE_ANIMATION_SPEED_MAX,
  SPINE_ANIMATION_SPEED_MIN,
  SPINE_ANIMATION_SPEED_STEP,
  SPINE_VIEW_SCALE_MAX,
  SPINE_VIEW_SCALE_MIN,
  SPINE_VIEW_SCALE_STEP,
} from "../../utils/spineViewScale";
import styles from "./SettingsPanel.module.scss";

const SCALE_MIN = SPINE_VIEW_SCALE_MIN;
const SCALE_MAX = SPINE_VIEW_SCALE_MAX;
const SCALE_STEP = SPINE_VIEW_SCALE_STEP;

const SPEED_MIN = SPINE_ANIMATION_SPEED_MIN;
const SPEED_MAX = SPINE_ANIMATION_SPEED_MAX;
const SPEED_STEP = SPINE_ANIMATION_SPEED_STEP;

/**
 * iOS Files often types .atlas as text/plain or octet-stream and hides them if `accept` is
 * extension-only. MIME types plus a wildcard media type keep the picker inclusive;
 * `classifySpineFiles` still validates.
 */
const SPINE_FILE_INPUT_ACCEPT = [
  ".json",
  ".skel",
  ".atlas",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  "application/json",
  "text/plain",
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "image/webp",
  "*/*",
].join(",");

/** Drop focus after pointer drag/click; Escape for keyboard exit (arrows keep focus while adjusting). */
const rangeReleaseFocusProps = {
  onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  },
  onPointerCancel: (e: React.PointerEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  },
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  },
};

export interface SettingsPanelProps {
  animations: string[];
  selectedAnimation: string;
  onAnimationChange: (name: string) => void;
  playbackTransport: SpinePlaybackTransport;
  animationLoop: boolean;
  onAnimationLoopChange: (loop: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  canvasScale: number;
  onCanvasScaleChange: (scale: number) => void;
  animationSpeed: number;
  onAnimationSpeedChange: (speed: number) => void;
  onResetAnimationSpeed: () => void;
  onResetLayout: () => void;
  onLoadSpineFiles?: (files: File[]) => void;
  spineLoadError?: string | null;
  /** Shown left of the Load Spine control (bundled sample or skeleton file base name). */
  loadedSpineName: string;
  /** Hides the settings panel (e.g. mobile); host should offer a way to reopen. */
  onClose: () => void;
}

export function SettingsPanel({
  animations,
  selectedAnimation,
  onAnimationChange,
  playbackTransport,
  animationLoop,
  onAnimationLoopChange,
  onPlay,
  onPause,
  onStop,
  canvasScale,
  onCanvasScaleChange,
  animationSpeed,
  onAnimationSpeedChange,
  onResetAnimationSpeed,
  onResetLayout,
  onLoadSpineFiles,
  spineLoadError,
  loadedSpineName,
  onClose,
}: SettingsPanelProps) {
  const spineFileInputRef = useRef<HTMLInputElement>(null);
  const canPlayback = animations.length > 0 && Boolean(selectedAnimation);

  return (
    <aside className={styles.panel} aria-label="Spine configuration">
      <div className={styles.panelScroll}>
        <div className={styles.loadBlock}>
          <input
            ref={spineFileInputRef}
            className={styles.fileInput}
            type="file"
            accept={SPINE_FILE_INPUT_ACCEPT}
            multiple
            aria-label="Spine files: skeleton, atlas, and texture"
            onChange={(e) => {
              // Snapshot before clearing: FileList is live; resetting value empties it.
              const list = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (list.length && onLoadSpineFiles) {
                console.log("[SettingsPanel] file input change", {
                  count: list.length,
                  names: list.map((f) => f.name),
                });
                onLoadSpineFiles(list);
              }
            }}
          />
          <div className={styles.loadRow}>
            <span
              className={styles.loadedSpineName}
              title={loadedSpineName}
              aria-label={`Current Spine: ${loadedSpineName}`}
            >
              {loadedSpineName}
            </span>
            <button
              type="button"
              className={styles.loadButton}
              onClick={() => spineFileInputRef.current?.click()}
            >
              Choose…
            </button>
          </div>
          <p className={styles.loadHint}>
            Select 3 files: .json or .skel, .atlas, and image (.png / .jpg /
            .webp). On iPhone, use Files; if .atlas is missing from the short
            list, open the full browser so every file type is shown; the app
            still checks names.
          </p>
          {spineLoadError ? (
            <p className={styles.loadError} role="alert">
              {spineLoadError}
            </p>
          ) : null}
        </div>
        <div className={styles.animationBlock}>
          <div className={styles.animationRow}>
            <label className={styles.label} htmlFor="animation-select">
              Animation
            </label>
            {animations.length === 0 ? (
              <p className={styles.mutedInline}>Loading animations…</p>
            ) : (
              <select
                id="animation-select"
                className={`${styles.select} ${styles.selectInline}`}
                value={selectedAnimation}
                onChange={(e) => {
                  onAnimationChange(e.target.value);
                  e.currentTarget.blur();
                }}
              >
                {animations.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div
            className={styles.playbackRow}
            role="group"
            aria-label="Animation playback"
          >
            <button
              type="button"
              className={styles.playbackButton}
              disabled={!canPlayback}
              onClick={onPlay}
              aria-pressed={playbackTransport === "playing"}
            >
              Play
            </button>
            <button
              type="button"
              className={styles.playbackButton}
              disabled={!canPlayback}
              onClick={onPause}
              aria-pressed={playbackTransport === "paused"}
            >
              Pause
            </button>
            <button
              type="button"
              className={styles.playbackButton}
              disabled={animations.length === 0}
              onClick={onStop}
              aria-pressed={playbackTransport === "stopped"}
            >
              Stop
            </button>
          </div>
          <label className={styles.loopCheckboxRow}>
            <input
              type="checkbox"
              className={styles.loopCheckbox}
              checked={animationLoop}
              onChange={(e) => onAnimationLoopChange(e.target.checked)}
              disabled={!canPlayback}
            />
            <span>Loop animation</span>
          </label>
        </div>
        <div className={styles.field}>
          <div className={styles.scaleHeader}>
            <label className={styles.label} htmlFor="scale-slider">
              Spine scale
            </label>
            <div className={styles.scaleHeaderActions}>
              <span className={styles.scaleValue} aria-live="polite">
                {canvasScale.toFixed(2)}×
              </span>
              <button
                type="button"
                className={styles.resetButton}
                onClick={onResetLayout}
              >
                Reset
              </button>
            </div>
          </div>
          <input
            id="scale-slider"
            className={styles.slider}
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={canvasScale}
            onChange={(e) => onCanvasScaleChange(Number(e.target.value))}
            {...rangeReleaseFocusProps}
          />
        </div>
        <div className={styles.field}>
          <div className={styles.scaleHeader}>
            <label className={styles.label} htmlFor="animation-speed-slider">
              Animation speed
            </label>
            <div className={styles.scaleHeaderActions}>
              <span className={styles.scaleValue} aria-live="polite">
                {animationSpeed.toFixed(2)}×
              </span>
              <button
                type="button"
                className={styles.resetButton}
                onClick={onResetAnimationSpeed}
                aria-label="Reset animation speed to 1×"
              >
                Reset
              </button>
            </div>
          </div>
          <input
            id="animation-speed-slider"
            className={styles.slider}
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={animationSpeed}
            onChange={(e) => onAnimationSpeedChange(Number(e.target.value))}
            {...rangeReleaseFocusProps}
          />
        </div>
        <div className={styles.shortcutsBlock}>
          <p className={styles.shortcutsTitle}>Mouse</p>
          <ul className={styles.shortcutsList}>
            <li>
              <strong>Wheel</strong> — zoom in/out
            </li>
            <li>
              <strong>Shift</strong> + wheel — change animation speed
            </li>
          </ul>
          <p className={styles.shortcutsTitle}>Keyboard</p>
          <ul className={styles.shortcutsList}>
            <li>
              <strong>P</strong> — pause / play
            </li>
            <li>
              <strong>↑</strong> <strong>↓</strong> — previous / next animation
            </li>
            <li>
              <strong>+</strong> <strong>−</strong> — zoom in/out
            </li>
            <li>
              <strong>←</strong> <strong>→</strong> — even slower / faster speed
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.panelFooter}>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  );
}
