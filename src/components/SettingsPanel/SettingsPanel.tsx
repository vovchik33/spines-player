import React, { useEffect, useRef, useState, type CSSProperties } from "react";
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

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function readName(v: unknown): string {
  const raw = asRecord(v)?.name;
  return typeof raw === "string" ? raw.trim() : "";
}

function extractNamedList(section: string, value: unknown): string[] {
  if (section === "animations") {
    if (Array.isArray(value)) {
      return value.map((item) => readName(item)).filter(Boolean);
    }
    const obj = asRecord(value);
    return obj ? Object.keys(obj) : [];
  }

  if (section === "skins") {
    if (Array.isArray(value)) {
      return value.map((item) => readName(item)).filter(Boolean);
    }
    const obj = asRecord(value);
    return obj ? Object.keys(obj) : [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => readName(item)).filter(Boolean);
  }

  return [];
}

export interface SettingsPanelProps {
  animations: string[];
  selectedAnimation: string;
  onAnimationChange: (name: string) => void;
  animationSequence: string[];
  animationSequenceIndex: number;
  onAddAnimationToSequence: () => void;
  onAddAnimationNameToSequence: (name: string) => void;
  onClearAnimationSequence: () => void;
  onCloneSequenceItem: (index: number) => void;
  onDeleteSequenceItem: (index: number) => void;
  onMoveSequenceItemUp: (index: number) => void;
  onMoveSequenceItemDown: (index: number) => void;
  onInsertSequenceItem: (fromIndex: number, insertIndex: number) => void;
  playbackTransport: SpinePlaybackTransport;
  animationLoop: boolean;
  onAnimationLoopChange: (loop: boolean) => void;
  sequenceActive: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  canvasScale: number;
  onCanvasScaleChange: (scale: number) => void;
  animationSpeed: number;
  onAnimationSpeedChange: (speed: number) => void;
  onResetAnimationSpeed: () => void;
  playerBackgroundColor: string;
  onPlayerBackgroundColorChange: (color: string) => void;
  playerBackgroundImageName: string | null;
  onPlayerBackgroundImageChange: (file: File | null) => void;
  onResetLayout: () => void;
  onLoadSpineFiles?: (files: File[]) => void;
  spineLoadError?: string | null;
  /** Shown left of the Load Spine control (bundled sample or skeleton file base name). */
  loadedSpineName: string;
  hasCustomSpineLoaded: boolean;
  spineJsonRoot: Record<string, unknown> | null;
  spineJsonError: string | null;
  panelWidth: number;
  panelHeight: number;
  onVerticalResizeStart: (clientY: number) => void;
  onVerticalResizeMove: (clientY: number) => void;
  onVerticalResizeEnd: () => void;
  /** Hides the settings panel (e.g. mobile); host should offer a way to reopen. */
  onClose: () => void;
}

export function SettingsPanel({
  animations,
  selectedAnimation,
  onAnimationChange,
  animationSequence,
  animationSequenceIndex,
  onAddAnimationToSequence,
  onAddAnimationNameToSequence,
  onClearAnimationSequence,
  onCloneSequenceItem,
  onDeleteSequenceItem,
  onMoveSequenceItemUp,
  onMoveSequenceItemDown,
  onInsertSequenceItem,
  playbackTransport,
  animationLoop,
  onAnimationLoopChange,
  sequenceActive,
  onPlay,
  onPause,
  onStop,
  canvasScale,
  onCanvasScaleChange,
  animationSpeed,
  onAnimationSpeedChange,
  onResetAnimationSpeed,
  playerBackgroundColor,
  onPlayerBackgroundColorChange,
  playerBackgroundImageName,
  onPlayerBackgroundImageChange,
  onResetLayout,
  onLoadSpineFiles,
  spineLoadError,
  loadedSpineName,
  hasCustomSpineLoaded,
  spineJsonRoot,
  spineJsonError,
  panelWidth,
  panelHeight,
  onVerticalResizeStart,
  onVerticalResizeMove,
  onVerticalResizeEnd,
  onClose,
}: SettingsPanelProps) {
  const spineFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundImageInputRef = useRef<HTMLInputElement>(null);
  const animationSelectRef = useRef<HTMLDivElement>(null);
  const animationDropdownCloseTimerRef = useRef<number | null>(null);
  const verticalResizePointerIdRef = useRef<number | null>(null);
  const [jsonTreeVisible, setJsonTreeVisible] = useState(false);
  const [sequenceListVisible, setSequenceListVisible] = useState(true);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [animationDropdownOpen, setAnimationDropdownOpen] = useState(false);
  const canPlayback = animations.length > 0 && Boolean(selectedAnimation);
  const panelStyle = {
    "--settings-panel-width": `${panelWidth}px`,
    "--settings-panel-height": `${panelHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    return () => {
      if (animationDropdownCloseTimerRef.current !== null) {
        window.clearTimeout(animationDropdownCloseTimerRef.current);
        animationDropdownCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!animationDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!animationSelectRef.current) return;
      if (animationSelectRef.current.contains(e.target as Node)) return;
      setAnimationDropdownOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAnimationDropdownOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [animationDropdownOpen]);

  return (
    <aside className={styles.panel} style={panelStyle} aria-label="Spine configuration">
      <button
        type="button"
        className={styles.topResizeHandle}
        aria-label="Resize settings panel height"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          verticalResizePointerIdRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          onVerticalResizeStart(e.clientY);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (verticalResizePointerIdRef.current !== e.pointerId) return;
          onVerticalResizeMove(e.clientY);
        }}
        onPointerUp={(e) => {
          if (verticalResizePointerIdRef.current !== e.pointerId) return;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          verticalResizePointerIdRef.current = null;
          onVerticalResizeEnd();
        }}
        onPointerCancel={(e) => {
          if (verticalResizePointerIdRef.current !== e.pointerId) return;
          verticalResizePointerIdRef.current = null;
          onVerticalResizeEnd();
        }}
        onLostPointerCapture={() => {
          verticalResizePointerIdRef.current = null;
          onVerticalResizeEnd();
        }}
      />
      <div className={styles.panelScroll}>
        <div className={styles.loadBlock}>
          <input
            ref={spineFileInputRef}
            className={styles.fileInput}
            type="file"
            accept={SPINE_FILE_INPUT_ACCEPT}
            multiple
            aria-label="Spine files: skeleton, atlas, and one or more textures"
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
              Open...
            </button>
          </div>
          {spineLoadError ? (
            <p className={styles.loadError} role="alert">
              {spineLoadError}
            </p>
          ) : null}
        </div>
        <div className={styles.jsonTreeBlock}>
          <div className={styles.jsonTreeHeader}>
            <p className={styles.shortcutsTitle}>Spine info</p>
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => setJsonTreeVisible((v) => !v)}
            >
              {jsonTreeVisible ? "Hide" : "Show"}
            </button>
          </div>
          {spineJsonError ? (
            <p className={styles.loadError} role="alert">
              {spineJsonError}
            </p>
          ) : null}
          {spineJsonRoot ? (
            jsonTreeVisible ? (
              <div className={styles.jsonTree}>
                {Object.entries(spineJsonRoot).map(([section, sectionValue]) => {
                  const isNameOnlySection =
                    section === "bones" ||
                    section === "slots" ||
                    section === "skins" ||
                    section === "animations";
                  const isRawSection = section === "skeleton" || section === "transform";
                  const names = isNameOnlySection
                    ? extractNamedList(section, sectionValue)
                    : [];
                  return (
                    <details key={section} className={styles.jsonTreeSection}>
                      <summary className={styles.jsonTreeSummary}>{section}</summary>
                      {isNameOnlySection ? (
                        names.length > 0 ? (
                          <ul className={styles.jsonNameList}>
                            {names.map((name, idx) => (
                              <li key={`${section}-${idx}-${name}`}>{name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.muted}>No names</p>
                        )
                      ) : isRawSection ? (
                        <pre className={styles.jsonRaw}>
                          {JSON.stringify(sectionValue, null, 2)}
                        </pre>
                      ) : (
                        <p className={styles.muted}>
                          {Array.isArray(sectionValue)
                            ? `${sectionValue.length} items`
                            : typeof sectionValue}
                        </p>
                      )}
                    </details>
                  );
                })}
              </div>
            ) : null
          ) : (
            <p className={styles.muted}>Spine JSON tree is not available yet.</p>
          )}
        </div>
        <div className={styles.animationBlock}>
          <div className={styles.animationRow}>
            <label className={styles.label} htmlFor="animation-select">
              Animation
            </label>
            {animations.length === 0 ? (
              <p className={styles.mutedInline}>Loading animations…</p>
            ) : (
              <>
                <div
                  className={styles.animationSelectWrap}
                  ref={animationSelectRef}
                  onMouseEnter={() => {
                    if (animationDropdownCloseTimerRef.current !== null) {
                      window.clearTimeout(animationDropdownCloseTimerRef.current);
                      animationDropdownCloseTimerRef.current = null;
                    }
                    setAnimationDropdownOpen(true);
                  }}
                  onMouseLeave={() => {
                    if (animationDropdownCloseTimerRef.current !== null) {
                      window.clearTimeout(animationDropdownCloseTimerRef.current);
                    }
                    animationDropdownCloseTimerRef.current = window.setTimeout(() => {
                      setAnimationDropdownOpen(false);
                      animationDropdownCloseTimerRef.current = null;
                    }, 300);
                  }}
                >
                  <button
                    id="animation-select"
                    type="button"
                    className={`${styles.select} ${styles.selectInline} ${styles.selectButton}`}
                    aria-haspopup="listbox"
                    aria-expanded={animationDropdownOpen}
                    aria-controls="animation-select-listbox"
                    onClick={() => setAnimationDropdownOpen((v) => !v)}
                  >
                    <span className={styles.selectButtonLabel}>{selectedAnimation}</span>
                    <span className={styles.selectButtonChevron} aria-hidden>
                      ▾
                    </span>
                  </button>
                  {animationDropdownOpen ? (
                    <ul
                      id="animation-select-listbox"
                      role="listbox"
                      aria-label="Animation"
                      className={styles.selectMenu}
                    >
                      {animations.map((name) => (
                        <li key={name} role="option" aria-selected={name === selectedAnimation}>
                          <div
                            className={`${styles.selectMenuRow} ${
                              name === selectedAnimation ? styles.selectMenuItemSelected : ""
                            }`}
                          >
                            <button
                              type="button"
                              className={styles.selectMenuItem}
                              onClick={() => {
                                onAnimationChange(name);
                                setAnimationDropdownOpen(false);
                              }}
                            >
                              {name}
                            </button>
                            <button
                              type="button"
                              className={styles.selectMenuAddButton}
                              aria-label={`Add ${name} to sequence`}
                              title="Add to sequence"
                              onClick={() => {
                                onAddAnimationNameToSequence(name);
                              }}
                            >
                              <svg
                                className={styles.selectMenuAddIcon}
                                viewBox="0 0 24 24"
                                aria-hidden
                              >
                                <rect
                                  x="4"
                                  y="4"
                                  width="9"
                                  height="9"
                                  fill="currentColor"
                                  opacity="0.5"
                                />
                                <rect
                                  x="7.5"
                                  y="7.5"
                                  width="9"
                                  height="9"
                                  fill="currentColor"
                                  opacity="0.75"
                                />
                                <rect x="11" y="11" width="9" height="9" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={styles.addSequenceButton}
                  onClick={onAddAnimationToSequence}
                  disabled={!selectedAnimation}
                  aria-label="Add selected animation to sequence"
                  title="Add selected animation to sequence"
                >
                  <svg
                    className={styles.addSequenceIcon}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <rect x="4" y="4" width="9" height="9" fill="currentColor" opacity="0.5" />
                    <rect x="7.5" y="7.5" width="9" height="9" fill="currentColor" opacity="0.75" />
                    <rect x="11" y="11" width="9" height="9" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
          </div>
          {animationSequence.length > 0 ? (
            <div className={styles.sequenceBlock}>
              <div className={styles.sequenceHeader}>
                <p className={styles.sequenceTitle}>Animation sequence</p>
                <div className={styles.sequenceHeaderActions}>
                  <button
                    type="button"
                    className={styles.clearSequenceButton}
                    onClick={() => setSequenceListVisible((v) => !v)}
                  >
                    {sequenceListVisible ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className={styles.clearSequenceButton}
                    onClick={onClearAnimationSequence}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {sequenceListVisible ? (
                <ol className={styles.sequenceList}>
                  {animationSequence.map((name, idx) => (
                    <li
                      key={`${name}-${idx}`}
                      className={`${styles.sequenceItem} ${
                        playbackTransport === "playing" && idx === animationSequenceIndex
                          ? styles.sequenceItemActive
                          : ""
                      } ${
                        dragFromIndex !== null && dragOverIndex === idx
                          ? styles.sequenceItemInsertTop
                          : ""
                      } ${
                        dragFromIndex !== null && dragOverIndex === idx + 1
                          ? styles.sequenceItemInsertBottom
                          : ""
                      }`}
                      draggable
                      onDragStart={(e) => {
                        setDragFromIndex(idx);
                        setDragOverIndex(null);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      onDragOver={(e) => {
                        if (dragFromIndex === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const r = e.currentTarget.getBoundingClientRect();
                        const insertIndex =
                          e.clientY < r.top + r.height / 2 ? idx : idx + 1;
                        if (dragOverIndex !== insertIndex) {
                          setDragOverIndex(insertIndex);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragFromIndex === null) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const insertIndex =
                          e.clientY < r.top + r.height / 2 ? idx : idx + 1;
                        onInsertSequenceItem(dragFromIndex, insertIndex);
                        setDragFromIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragFromIndex(null);
                        setDragOverIndex(null);
                      }}
                    >
                      <span className={styles.sequenceItemName}>{name}</span>
                      <span className={styles.sequenceItemActions}>
                        <button
                          type="button"
                          className={styles.sequenceActionButton}
                          onClick={() => onCloneSequenceItem(idx)}
                          aria-label={`Copy ${name} below`}
                          title="Copy"
                        >
                          <svg
                            className={styles.sequenceActionIcon}
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path
                              d="M9 9h11v11H9zM4 4h11v2H6v9H4z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={styles.sequenceActionButton}
                          onClick={() => onMoveSequenceItemDown(idx)}
                          disabled={idx === animationSequence.length - 1}
                          aria-label={`Move ${name} down`}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={styles.sequenceActionButton}
                          onClick={() => onMoveSequenceItemUp(idx)}
                          disabled={idx === 0}
                          aria-label={`Move ${name} up`}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.sequenceActionButton}
                          onClick={() => onDeleteSequenceItem(idx)}
                          aria-label={`Delete ${name}`}
                          title="Delete"
                        >
                          <svg
                            className={styles.sequenceActionIcon}
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path
                              d="M9 4h6l1 2h4v2H4V6h4l1-2zm-2 6h2v8H7v-8zm4 0h2v8h-2v-8zm4 0h2v8h-2v-8z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
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
              <svg
                className={styles.playbackIcon}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
              Play
            </button>
            <button
              type="button"
              className={styles.playbackButton}
              disabled={!canPlayback}
              onClick={onPause}
              aria-pressed={playbackTransport === "paused"}
            >
              <svg
                className={styles.playbackIcon}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor" />
              </svg>
              Pause
            </button>
            <button
              type="button"
              className={styles.playbackButton}
              disabled={animations.length === 0}
              onClick={onStop}
              aria-pressed={playbackTransport === "stopped"}
            >
              <svg
                className={styles.playbackIcon}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <rect x="6" y="6" width="12" height="12" fill="currentColor" />
              </svg>
              Stop
            </button>
          </div>
          <label className={styles.loopCheckboxRow}>
            <input
              type="checkbox"
              className={styles.loopCheckbox}
              checked={animationLoop}
              onChange={(e) => onAnimationLoopChange(e.target.checked)}
              disabled={!canPlayback || sequenceActive}
            />
            <span>
              {sequenceActive ? "Loop animation (off while sequence is active)" : "Loop animation"}
            </span>
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
        <div className={styles.field}>
          <div className={styles.colorRow}>
            <label className={styles.label}>
              Background
            </label>
          </div>
          <input
            ref={backgroundImageInputRef}
            className={styles.fileInput}
            type="file"
            accept="image/*"
            aria-label="Choose background image"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              onPlayerBackgroundImageChange(file);
            }}
          />
          <div className={styles.backgroundImageRow}>
            <span
              className={styles.backgroundImageName}
              title={playerBackgroundImageName ?? "No image selected"}
              aria-live="polite"
            >
              {playerBackgroundImageName ?? "No image selected"}
            </span>
            <div className={styles.backgroundImageActions}>
              <button
                type="button"
                className={styles.resetButton}
                onClick={() => backgroundImageInputRef.current?.click()}
              >
                ...
              </button>
              <button
                type="button"
                className={styles.resetButton}
                disabled={!playerBackgroundImageName}
                onClick={() => onPlayerBackgroundImageChange(null)}
              >
                Clear
              </button>
              <input
                id="background-color-input"
                className={styles.colorInput}
                type="color"
                value={playerBackgroundColor}
                aria-label="Player background color"
                onChange={(e) => onPlayerBackgroundColorChange(e.target.value)}
                {...rangeReleaseFocusProps}
              />
            </div>
          </div>
        </div>
        <div className={styles.shortcutsBlock}>
          {!hasCustomSpineLoaded ? (
            <p className={styles.loadHint}>
              Select at least 3 files: one .json or .skel file, one .atlas
              file, and one or more image files (.png / .jpg / .webp). On
              iPhone, use the Files app; if .atlas is missing from the short
              list, open the full file browser so all file types are visible.
              The app still validates file names.
            </p>
          ) : null}
          <p className={styles.shortcutsTitle}>Mouse</p>
          <ul className={styles.shortcutsList}>
            <li>
              <strong>Wheel</strong> — spine zoom in/out
            </li>
            <li>
              <strong>Shift</strong> + wheel — background zoom in/out
            </li>
            <li>
              <strong>Shift</strong> + drag — move background
            </li>
          </ul>
          <p className={styles.shortcutsTitle}>Keyboard</p>
          <ul className={styles.shortcutsList}>
            <li>
              <strong>S</strong> — show / hide settings
            </li>
            <li>
              <strong>←</strong> <strong>→</strong> — previous / next animation
            </li>
            <li>
              <strong>↑</strong> <strong>↓</strong> — even slower / faster speed
            </li>
            <li>
              <strong>+</strong> <strong>−</strong> — zoom in/out
            </li>
            <li>
              <strong>P</strong> or <strong>Space</strong> — pause / play
            </li>
            <li>
              <strong>R</strong> — reset position / scale / speed
            </li>
            <li>
              <strong>Shift</strong> + <strong>R</strong> — reset background position / scale
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
