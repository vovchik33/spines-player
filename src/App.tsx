import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pixi8SpinePlayer,
  type SpinePlaybackTransport,
} from './SpinePlayer/SpinePlayer'
import { SettingsPanel } from './SettingsPanel/SettingsPanel'
import {
  classifySpineFiles,
  createSpineObjectUrls,
  getAtlasPageName,
} from './spine/loadSpineFiles'
import {
  SPINE_ANIMATION_SPEED_MAX,
  SPINE_ANIMATION_SPEED_MIN,
  SPINE_ANIMATION_SPEED_STEP,
  SPINE_VIEW_SCALE_MAX,
  SPINE_VIEW_SCALE_MIN,
  SPINE_VIEW_SCALE_STEP,
} from './spineViewScale'
import styles from './App.module.scss'

const INITIAL_CANVAS_SCALE = 1
const INITIAL_ANIMATION_SPEED = 1

type CustomSpinePack = {
  displayName: string
  skeletonUrl: string
  atlasUrl: string
  atlasImageMap: Record<string, string>
  revoke: () => void
}

function skeletonFileDisplayName(file: File): string {
  return file.name.replace(/\.(json|skel)$/i, '') || file.name
}

export default function App() {
  const base = import.meta.env.BASE_URL
  const defaultSkeletonUrl = `${base}spine/Cat.json`
  const defaultAtlasUrl = `${base}spine/Cat.atlas`

  const [animation, setAnimation] = useState('1_Idle')
  const [animations, setAnimations] = useState<string[]>([])
  const [playbackTransport, setPlaybackTransport] =
    useState<SpinePlaybackTransport>('playing')
  const [animationLoop, setAnimationLoop] = useState(true)
  const [playbackNonce, setPlaybackNonce] = useState(0)

  const playbackTransportRef = useRef(playbackTransport)
  const animationsRef = useRef(animations)
  const animationRef = useRef(animation)

  useEffect(() => {
    playbackTransportRef.current = playbackTransport
  }, [playbackTransport])

  useEffect(() => {
    animationsRef.current = animations
    animationRef.current = animation
  }, [animations, animation])

  const bumpPlayback = useCallback(() => {
    setPlaybackNonce((n) => n + 1)
  }, [])

  const handlePlay = useCallback(() => {
    const prev = playbackTransportRef.current
    setPlaybackTransport('playing')
    if (prev !== 'paused') {
      bumpPlayback()
    }
  }, [bumpPlayback])

  /** Pause when playing; press again to resume (same as P key). */
  const handlePause = useCallback(() => {
    const prev = playbackTransportRef.current
    if (prev === 'paused') {
      setPlaybackTransport('playing')
    } else {
      setPlaybackTransport('paused')
    }
  }, [])

  const handleStop = useCallback(() => {
    setPlaybackTransport('stopped')
    bumpPlayback()
  }, [bumpPlayback])

  const [canvasScale, setCanvasScale] = useState(INITIAL_CANVAS_SCALE)
  const [animationSpeed, setAnimationSpeed] = useState(INITIAL_ANIMATION_SPEED)
  const [layoutResetToken, setLayoutResetToken] = useState(0)
  const [customSpine, setCustomSpine] = useState<CustomSpinePack | null>(null)
  const [spineLoadError, setSpineLoadError] = useState<string | null>(null)

  const customSpineRef = useRef<CustomSpinePack | null>(null)

  useEffect(() => {
    customSpineRef.current = customSpine
  }, [customSpine])

  useEffect(() => {
    return () => {
      if (customSpineRef.current) {
        console.log('[App] unmount: revoke custom spine object URLs')
      }
      customSpineRef.current?.revoke()
    }
  }, [])

  useEffect(() => {
    const isEditableKeyTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return Boolean(
        target.closest(
          'button, a[href], input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"]',
        ),
      )
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableKeyTarget(e.target)) return

      if (e.code === 'KeyP') {
        if (e.repeat) return
        e.preventDefault()
        const prev = playbackTransportRef.current
        if (prev === 'playing') {
          setPlaybackTransport('paused')
          return
        }
        setPlaybackTransport('playing')
        if (prev === 'stopped') {
          bumpPlayback()
        }
        return
      }

      // Animation speed: ArrowLeft / ArrowRight (`code` is layout-independent).
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setAnimationSpeed((s) =>
          Math.max(
            SPINE_ANIMATION_SPEED_MIN,
            s - SPINE_ANIMATION_SPEED_STEP,
          ),
        )
        return
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        setAnimationSpeed((s) =>
          Math.min(
            SPINE_ANIMATION_SPEED_MAX,
            s + SPINE_ANIMATION_SPEED_STEP,
          ),
        )
        return
      }

      // `-` / `+`: Minus & NumpadSubtract; Equal (= and + share one key) & NumpadAdd.
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        setCanvasScale((s) =>
          Math.max(SPINE_VIEW_SCALE_MIN, s - SPINE_VIEW_SCALE_STEP),
        )
        return
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault()
        setCanvasScale((s) =>
          Math.min(SPINE_VIEW_SCALE_MAX, s + SPINE_VIEW_SCALE_STEP),
        )
        return
      }

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const names = animationsRef.current
        if (names.length === 0) return
        e.preventDefault()
        const raw = animationRef.current
        const current = names.includes(raw) ? raw : names[0]
        const idx = names.indexOf(current)
        const delta = e.code === 'ArrowDown' ? 1 : -1
        const nextIdx = (idx + delta + names.length) % names.length
        setAnimation(names[nextIdx])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bumpPlayback])

  const handleLoadSpineFiles = useCallback(async (files: File[]) => {
    console.log('[App] Load Spine: picked files', files.length)
    setSpineLoadError(null)
    const r = classifySpineFiles(files)
    if (!r.ok) {
      console.warn('[App] Load Spine: rejected —', r.message)
      setSpineLoadError(r.message)
      return
    }
    try {
      const atlasPageName = await getAtlasPageName(r.atlas)
      const urls = createSpineObjectUrls({
        skeleton: r.skeleton,
        atlas: r.atlas,
        texture: r.texture,
        atlasPageName,
      })
      const displayName = skeletonFileDisplayName(r.skeleton)
      const next: CustomSpinePack = {
        ...urls,
        displayName,
      }
      console.log('[App] Load Spine: applying pack', { displayName, atlasPageName })
      setAnimations([])
      setPlaybackTransport('playing')
      setAnimationLoop(true)
      setCanvasScale(INITIAL_CANVAS_SCALE)
      setAnimationSpeed(INITIAL_ANIMATION_SPEED)
      setPlaybackNonce((n) => n + 1)
      setCustomSpine((prev) => {
        if (prev) {
          console.log('[App] Load Spine: revoking previous custom pack')
          prev.revoke()
        }
        return next
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to read Spine files'
      console.error('[App] Load Spine: error', e)
      setSpineLoadError(msg)
    }
  }, [])

  const resetLayout = () => {
    console.log('[App] Reset layout (spine scale + pan + renderer remeasure)')
    setCanvasScale(INITIAL_CANVAS_SCALE)
    setAnimationSpeed(INITIAL_ANIMATION_SPEED)
    setLayoutResetToken((n) => n + 1)
  }

  const resetAnimationSpeed = useCallback(() => {
    setAnimationSpeed(INITIAL_ANIMATION_SPEED)
  }, [])

  const applySpineScaleDelta = useCallback((delta: number) => {
    setCanvasScale((s) =>
      Math.min(
        SPINE_VIEW_SCALE_MAX,
        Math.max(SPINE_VIEW_SCALE_MIN, s + delta),
      ),
    )
  }, [])

  const applyAnimationSpeedDelta = useCallback((delta: number) => {
    setAnimationSpeed((s) =>
      Math.min(
        SPINE_ANIMATION_SPEED_MAX,
        Math.max(SPINE_ANIMATION_SPEED_MIN, s + delta),
      ),
    )
  }, [])

  // While the list is empty (e.g. after Load Spine), avoid passing a stale clip name to the player.
  const selectedAnimation =
    animations.length === 0
      ? ''
      : animations.includes(animation)
        ? animation
        : animations[0]

  const skeletonUrl = customSpine?.skeletonUrl ?? defaultSkeletonUrl
  const atlasUrl = customSpine?.atlasUrl ?? defaultAtlasUrl
  const atlasImageMap = customSpine?.atlasImageMap
  const loadedSpineName = customSpine?.displayName ?? 'Cat'

  return (
    <div className={styles.layout}>
      <div className={styles.shell}>
        <SettingsPanel
          animations={animations}
          selectedAnimation={selectedAnimation}
          onAnimationChange={setAnimation}
          playbackTransport={playbackTransport}
          animationLoop={animationLoop}
          onAnimationLoopChange={setAnimationLoop}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          canvasScale={canvasScale}
          onCanvasScaleChange={setCanvasScale}
          animationSpeed={animationSpeed}
          onAnimationSpeedChange={setAnimationSpeed}
          onResetAnimationSpeed={resetAnimationSpeed}
          onResetLayout={resetLayout}
          onLoadSpineFiles={handleLoadSpineFiles}
          spineLoadError={spineLoadError}
          loadedSpineName={loadedSpineName}
        />
        <main className={styles.player}>
          <div className={styles.playerMeasure} data-layout-measure>
            <Pixi8SpinePlayer
              skeletonUrl={skeletonUrl}
              atlasUrl={atlasUrl}
              atlasImageMap={atlasImageMap}
              animation={selectedAnimation}
              playbackTransport={playbackTransport}
              animationLoop={animationLoop}
              playbackNonce={playbackNonce}
              animationSpeed={animationSpeed}
              spineScale={canvasScale}
              layoutResetToken={layoutResetToken}
              onSpineScaleDelta={applySpineScaleDelta}
              onAnimationSpeedDelta={applyAnimationSpeedDelta}
              onAnimationsLoaded={(names) => {
                console.log('[App] onAnimationsLoaded', { count: names.length, names })
                setAnimations(names)
              }}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
