import { useState } from 'react'
import { DraggableArea } from './DraggableArea/DraggableArea'
import { Pixi8SpinePlayer } from './SpinePlayer/SpinePlayer'
import styles from './App.module.scss'

const SCALE_MIN = 0.25
const SCALE_MAX = 3
const SCALE_STEP = 0.05
const INITIAL_CANVAS_SCALE = 1

export default function App() {
  const base = import.meta.env.BASE_URL
  const [animation, setAnimation] = useState('1_Idle')
  const [animations, setAnimations] = useState<string[]>([])
  const [canvasScale, setCanvasScale] = useState(INITIAL_CANVAS_SCALE)
  const [layoutResetToken, setLayoutResetToken] = useState(0)

  const resetLayout = () => {
    setCanvasScale(INITIAL_CANVAS_SCALE)
    setLayoutResetToken((n) => n + 1)
  }

  const selectedAnimation =
    animations.length > 0 && !animations.includes(animation)
      ? animations[0]
      : animation

  return (
    <div className={styles.layout}>
      <div className={styles.shell}>
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
                onChange={(e) => setAnimation(e.target.value)}
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
              <span className={styles.scaleValue} aria-live="polite">
                {canvasScale.toFixed(2)}×
              </span>
            </div>
            <input
              id="scale-slider"
              className={styles.slider}
              type="range"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={SCALE_STEP}
              value={canvasScale}
              onChange={(e) => setCanvasScale(Number(e.target.value))}
            />
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetLayout}
            >
              Reset
            </button>
          </div>
        </aside>
        <main className={styles.player}>
          <DraggableArea scale={canvasScale} layoutResetToken={layoutResetToken}>
            <Pixi8SpinePlayer
              skeletonUrl={`${base}spine/Cat.json`}
              atlasUrl={`${base}spine/Cat.atlas`}
              animation={selectedAnimation}
              layoutResetToken={layoutResetToken}
              onAnimationsLoaded={setAnimations}
            />
          </DraggableArea>
        </main>
      </div>
    </div>
  )
}
