import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react'
import {
  Pixi8SpinePlayer,
  SPINE_FRAME_COUNTER_FPS,
  type Pixi8SpinePlayerHandle,
  type SpineAnimationFrameInfo,
  type SpinePlaybackTransport,
} from './components/SpinePlayer/SpinePlayer'
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel'
import {
  classifySpineFiles,
  createSpineObjectUrls,
  getAtlasPageName,
} from './utils/loadSpineFiles'
import {
  SPINE_ANIMATION_SPEED_MAX,
  SPINE_ANIMATION_SPEED_MIN,
  SPINE_ANIMATION_SPEED_STEP,
  SPINE_VIEW_SCALE_MAX,
  SPINE_VIEW_SCALE_MIN,
  SPINE_VIEW_SCALE_STEP,
} from './utils/spineViewScale'
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
  const [scrubDragging, setScrubDragging] = useState(false)

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
    setScrubDragging(false)
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

  const goAdjacentAnimation = useCallback(
    (delta: number) => {
      if (animations.length === 0) return
      const raw = animation
      const current = animations.includes(raw) ? raw : animations[0]
      const idx = animations.indexOf(current)
      const nextIdx = (idx + delta + animations.length) % animations.length
      setAnimation(animations[nextIdx])
    },
    [animations, animation],
  )

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

  const [animationFrames, setAnimationFrames] =
    useState<SpineAnimationFrameInfo | null>(null)

  const onAnimationFrames = useCallback(
    (info: SpineAnimationFrameInfo | null) => {
      setAnimationFrames(info)
    },
    [],
  )

  const spinePlayerRef = useRef<Pixi8SpinePlayerHandle>(null)
  const [playbackProgress1000, setPlaybackProgress1000] = useState(0)
  const [scrubUiValue, setScrubUiValue] = useState(0)
  const scrubDraggingRef = useRef(false)
  const lastScrubValue1000Ref = useRef(0)
  const rafProgressRef = useRef(0)
  const pendingProgressRef = useRef(0)

  useEffect(() => {
    scrubDraggingRef.current = scrubDragging
  }, [scrubDragging])

  useEffect(() => {
    return () => {
      if (rafProgressRef.current) {
        cancelAnimationFrame(rafProgressRef.current)
      }
    }
  }, [])

  const onAnimationProgressNormalized = useCallback((n: number) => {
    if (scrubDraggingRef.current) return
    pendingProgressRef.current = n
    if (rafProgressRef.current) return
    rafProgressRef.current = requestAnimationFrame(() => {
      rafProgressRef.current = 0
      setPlaybackProgress1000(Math.round(pendingProgressRef.current * 1000))
    })
  }, [])

  const scrubDisabled =
    animations.length === 0 || playbackTransport === 'stopped'

  const applyScrubValue = useCallback((value1000: number) => {
    const clamped = Math.max(0, Math.min(1000, Math.round(value1000)))
    lastScrubValue1000Ref.current = clamped
    setScrubUiValue(clamped)
    spinePlayerRef.current?.seekTrack0ToNormalized(clamped / 1000)
  }, [])

  const finishScrubInteraction = useCallback((value1000: number) => {
    if (!scrubDraggingRef.current) return
    if (rafProgressRef.current) {
      cancelAnimationFrame(rafProgressRef.current)
      rafProgressRef.current = 0
    }
    const v = Math.max(0, Math.min(1000, Math.round(value1000)))
    lastScrubValue1000Ref.current = v
    setScrubUiValue(v)
    pendingProgressRef.current = v / 1000
    scrubDraggingRef.current = false
    setPlaybackProgress1000(v)
    setScrubDragging(false)
  }, [])

  const handleScrubPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (scrubDisabled) return
    if (playbackTransport === 'playing') {
      setPlaybackTransport('paused')
    }
    scrubDraggingRef.current = true
    setScrubDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    requestAnimationFrame(() =>
      applyScrubValue(Number(e.currentTarget.value)),
    )
  }

  const handleScrubPointerUp = (e: PointerEvent<HTMLInputElement>) => {
    if (!scrubDraggingRef.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    finishScrubInteraction(Number(e.currentTarget.value))
  }

  const handleScrubChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (scrubDisabled) return
    if (
      !scrubDraggingRef.current &&
      playbackTransportRef.current === 'playing'
    ) {
      setPlaybackTransport('paused')
      scrubDraggingRef.current = true
      setScrubDragging(true)
    }
    applyScrubValue(Number(e.target.value))
  }

  const handleScrubBlur = () => {
    if (!scrubDraggingRef.current) return
    finishScrubInteraction(lastScrubValue1000Ref.current)
  }

  const effectiveDisplayFps = SPINE_FRAME_COUNTER_FPS * animationSpeed

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
          <div
            className={`${styles.playerHudChip} ${styles.playerAnimationSpeedFps}`}
            aria-live="polite"
            aria-label={`Display frame rate about ${effectiveDisplayFps.toFixed(1)} frames per second at ${animationSpeed.toFixed(2)}× animation speed (${SPINE_FRAME_COUNTER_FPS} fps reference)`}
          >
            {effectiveDisplayFps.toFixed(1)} fps
          </div>
          <div
            className={`${styles.playerHudChip} ${styles.playerFramesCounter}`}
            aria-live="polite"
            aria-label={
              animationFrames
                ? `Animation frame ${animationFrames.current} of ${animationFrames.total}`
                : 'Animation frame'
            }
          >
            {animationFrames
              ? `${animationFrames.current} / ${animationFrames.total}`
              : '—'}
          </div>
          <div className={styles.playerMeasure} data-layout-measure>
            <Pixi8SpinePlayer
              ref={spinePlayerRef}
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
              onAnimationFrames={onAnimationFrames}
              onAnimationProgressNormalized={onAnimationProgressNormalized}
            />
            <div
              className={styles.playerAnimationBar}
              role="group"
              aria-label="Canvas animation"
            >
              <button
                type="button"
                className={styles.playerAnimNavButton}
                disabled={animations.length === 0}
                onClick={() => goAdjacentAnimation(-1)}
                aria-label="Previous animation"
              >
                ←
              </button>
              <button
                type="button"
                className={styles.playerAnimNavButton}
                disabled={animations.length === 0}
                onClick={() => goAdjacentAnimation(1)}
                aria-label="Next animation"
              >
                →
              </button>
              <div className={styles.playerAnimationBarBottom}>
                <div className={styles.playerAnimationBarStrip}>
                  <span
                    className={styles.playerAnimLabel}
                    title={
                      animations.length === 0 ? undefined : selectedAnimation
                    }
                  >
                    {animations.length === 0
                      ? 'Loading…'
                      : selectedAnimation || '—'}
                  </span>
                  <div className={styles.playerScrub}>
                    <input
                      type="range"
                      className={styles.playerScrubRange}
                      min={0}
                      max={1000}
                      step={1}
                      disabled={scrubDisabled}
                      value={
                        scrubDragging ? scrubUiValue : playbackProgress1000
                      }
                      aria-label="Animation progress"
                      onPointerDown={handleScrubPointerDown}
                      onPointerUp={handleScrubPointerUp}
                      onPointerCancel={handleScrubPointerUp}
                      onChange={handleScrubChange}
                      onBlur={handleScrubBlur}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
