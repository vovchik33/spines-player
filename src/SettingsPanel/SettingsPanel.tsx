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
}

export function SettingsPanel({
  animations,
  selectedAnimation,
  onAnimationChange,
  canvasScale,
  onCanvasScaleChange,
  onResetLayout,
}: SettingsPanelProps) {
  return (
    <aside className={styles.panel} aria-label="Spine configuration">
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="animation-select">
          Animation
        </label>
        {animations.length === 0 ? (
          <p className={styles.muted}>Loading animations…</p>
        ) : (
          <select
            id="animation-select"
            className={styles.select}
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
