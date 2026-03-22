import { useRef } from 'react'
import styles from './SettingsPanel.module.scss'

const SCALE_MIN = 0.25
const SCALE_MAX = 3
const SCALE_STEP = 0.05

export interface SettingsPanelProps {
  animations: string[]
  selectedAnimation: string
  onAnimationChange: (name: string) => void
  canvasScale: number
  onCanvasScaleChange: (scale: number) => void
  onResetLayout: () => void
  onLoadSpineFiles?: (files: File[]) => void
  spineLoadError?: string | null
  /** Shown left of the Load Spine control (bundled sample or skeleton file base name). */
  loadedSpineName: string
}

export function SettingsPanel({
  animations,
  selectedAnimation,
  onAnimationChange,
  canvasScale,
  onCanvasScaleChange,
  onResetLayout,
  onLoadSpineFiles,
  spineLoadError,
  loadedSpineName,
}: SettingsPanelProps) {
  const spineFileInputRef = useRef<HTMLInputElement>(null)

  return (
    <aside className={styles.panel} aria-label="Spine configuration">
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.loadBlock}>
        <input
          ref={spineFileInputRef}
          className={styles.fileInput}
          type="file"
          accept=".json,.skel,.atlas,.png,.jpg,.jpeg,.webp"
          multiple
          aria-label="Spine files: skeleton, atlas, and texture"
          onChange={(e) => {
            // Snapshot before clearing: FileList is live; resetting value empties it.
            const list = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            if (list.length && onLoadSpineFiles) {
              console.log('[SettingsPanel] file input change', {
                count: list.length,
                names: list.map((f) => f.name),
              })
              onLoadSpineFiles(list)
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
            Load Spine…
          </button>
        </div>
        <p className={styles.loadHint}>
          Select 3 files: .json or .skel, .atlas, and image (.png / .jpg / .webp).
        </p>
        {spineLoadError ? (
          <p className={styles.loadError} role="alert">
            {spineLoadError}
          </p>
        ) : null}
      </div>
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
            onChange={(e) => onAnimationChange(e.target.value)}
          >
            {animations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={styles.field}>
        <div className={styles.scaleHeader}>
          <label className={styles.label} htmlFor="scale-slider">
            Canvas scale
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
        />
      </div>
    </aside>
  )
}
