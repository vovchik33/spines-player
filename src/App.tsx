import { useState } from 'react'
import { DraggableArea } from './DraggableArea/DraggableArea'
import { Pixi8SpinePlayer } from './SpinePlayer/SpinePlayer'
import { SettingsPanel } from './SettingsPanel/SettingsPanel'
import styles from './App.module.scss'

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
        <SettingsPanel
          animations={animations}
          selectedAnimation={selectedAnimation}
          onAnimationChange={setAnimation}
          canvasScale={canvasScale}
          onCanvasScaleChange={setCanvasScale}
          onResetLayout={resetLayout}
        />
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
