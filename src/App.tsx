import { useEffect, useState } from 'react'
import { Pixi8SpinePlayer } from './SpinePlayer/SpinePlayer'
import styles from './App.module.scss'

const SCALE_MIN = 0.25
const SCALE_MAX = 3
const SCALE_STEP = 0.05

export default function App() {
  const base = import.meta.env.BASE_URL
  const [animation, setAnimation] = useState('1_Idle')
  const [animations, setAnimations] = useState<string[]>([])
  const [canvasScale, setCanvasScale] = useState(1)

  useEffect(() => {
    if (animations.length === 0) return
    if (!animations.includes(animation)) {
      setAnimation(animations[0])
    }
  }, [animations, animation])

  return (
    <div className={styles.layout}>
      <div className={styles.shell}>
        <aside className={styles.panel} aria-label="Spine configuration">
          <h1 className={styles.title}>Spine</h1>
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
                value={animation}
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
          </div>
        </aside>
        <main className={styles.player}>
          <Pixi8SpinePlayer
            skeletonUrl={`${base}spine/Cat.json`}
            atlasUrl={`${base}spine/Cat.atlas`}
            animation={animation}
            canvasScale={canvasScale}
            onAnimationsLoaded={setAnimations}
          />
        </main>
      </div>
    </div>
  )
}
