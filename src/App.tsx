import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
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

/** Touch-primary devices: auto-hide the animation bar; FPS/frame chips stay visible. Tap the player to show the bar again. */
const COARSE_POINTER_MEDIA = '(hover: none) and (pointer: coarse)'
const MOBILE_PLAYER_CHROME_HIDE_MS = 5000

const INITIAL_CANVAS_SCALE = 1
const INITIAL_ANIMATION_SPEED = 1

/** Horizontal center of the range thumb (px from input’s left border). Thumb width must match `--player-scrub-thumb-size` on the track. */
function rangeThumbCenterXPx(
  rangeEl: HTMLInputElement,
  thumbSizePx: number,
): number {
  const w = rangeEl.getBoundingClientRect().width
  if (w <= 0) return 0
  const thumb =
    Number.isFinite(thumbSizePx) && thumbSizePx > 0 ? thumbSizePx : 14
  if (w <= thumb) return w / 2
  const min = Number(rangeEl.min)
  const max = Number(rangeEl.max)
  const val = Number(rangeEl.value)
  const span = max - min
  const t = span > 0 ? (val - min) / span : 0
  return thumb / 2 + t * (w - thumb)
}

function readScrubThumbSizePx(rangeEl: HTMLInputElement): number {
  const raw = getComputedStyle(rangeEl)
    .getPropertyValue('--player-scrub-thumb-size')
    .trim()
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 14
}

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
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(true)

  const [isCoarsePointer, setIsCoarsePointer] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(COARSE_POINTER_MEDIA).matches,
  )
  const [touchChromeVisible, setTouchChromeVisible] = useState(true)
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(COARSE_POINTER_MEDIA)
    const onChange = () => setIsCoarsePointer(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current !== null) {
      clearTimeout(chromeHideTimerRef.current)
      chromeHideTimerRef.current = null
    }
  }, [])

  const scheduleChromeHide = useCallback(() => {
    clearChromeHideTimer()
    chromeHideTimerRef.current = window.setTimeout(() => {
      chromeHideTimerRef.current = null
      setTouchChromeVisible(false)
    }, MOBILE_PLAYER_CHROME_HIDE_MS)
  }, [clearChromeHideTimer])

  const bumpPlayerChrome = useCallback(() => {
    if (!isCoarsePointer) return
    setTouchChromeVisible(true)
    scheduleChromeHide()
  }, [isCoarsePointer, scheduleChromeHide])

  useEffect(() => {
    return () => clearChromeHideTimer()
  }, [clearChromeHideTimer])

  useEffect(() => {
    if (!isCoarsePointer) {
      clearChromeHideTimer()
      return
    }
    const id = window.setTimeout(() => {
      bumpPlayerChrome()
    }, 0)
    return () => clearTimeout(id)
  }, [isCoarsePointer, bumpPlayerChrome, clearChromeHideTimer])

  useEffect(() => {
    if (!isCoarsePointer) return
    if (scrubDragging) {
      clearChromeHideTimer()
    } else {
      scheduleChromeHide()
    }
  }, [
    scrubDragging,
    isCoarsePointer,
    clearChromeHideTimer,
    scheduleChromeHide,
  ])

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
    if (prev === 'playing') {
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
  }, [])

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
  }, [])

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
  const scrubRangeRef = useRef<HTMLInputElement>(null)
  const scrubThumbLabelRef = useRef<HTMLSpanElement>(null)
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

  const scrubDisabled = animations.length === 0

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
    if (playbackTransport === 'playing' || playbackTransport === 'stopped') {
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
      (playbackTransportRef.current === 'playing' ||
        playbackTransportRef.current === 'stopped')
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

  const scrubValue1000 = scrubDragging ? scrubUiValue : playbackProgress1000

  const scrubRangeStyle = {
    '--player-scrub-fill-pct': `${scrubValue1000 / 10}%`,
  } as CSSProperties

  const applyScrubThumbLabelPosition = useCallback(() => {
    const el = scrubRangeRef.current
    const label = scrubThumbLabelRef.current
    if (!el || !label) return
    const w = el.getBoundingClientRect().width
    const px = scrubDisabled
      ? w > 0
        ? w / 2
        : 0
      : rangeThumbCenterXPx(el, readScrubThumbSizePx(el))
    label.style.left = `${px}px`
  }, [scrubDisabled])

  useLayoutEffect(() => {
    applyScrubThumbLabelPosition()
  }, [scrubValue1000, applyScrubThumbLabelPosition])

  useEffect(() => {
    const el = scrubRangeRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => applyScrubThumbLabelPosition())
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyScrubThumbLabelPosition])

  const effectiveDisplayFps = SPINE_FRAME_COUNTER_FPS * animationSpeed

  return (
    <div className={styles.layout}>
      <div className={styles.shell}>
        {settingsPanelOpen && (
          <>
            <button
              type="button"
              className={styles.settingsSheetBackdrop}
              aria-label="Close settings"
              onClick={() => setSettingsPanelOpen(false)}
            />
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
              onClose={() => setSettingsPanelOpen(false)}
            />
          </>
        )}
        <main
          className={`${styles.player}${
            isCoarsePointer && !touchChromeVisible
              ? ` ${styles.playerTouchChromeHidden}`
              : ''
          }`}
          onPointerDownCapture={bumpPlayerChrome}
        >
          <button
            type="button"
            className={`${styles.playerHudChip} ${styles.playerAnimationSpeedFps}`}
            aria-live="polite"
            aria-label={`Display frame rate about ${effectiveDisplayFps.toFixed(1)} frames per second at ${animationSpeed.toFixed(2)}× animation speed (${SPINE_FRAME_COUNTER_FPS} fps reference). Open settings.`}
            onClick={() => setSettingsPanelOpen(true)}
          >
            {effectiveDisplayFps.toFixed(1)} fps
          </button>
          <button
            type="button"
            className={`${styles.playerHudChip} ${styles.playerFramesCounter}`}
            aria-live="polite"
            aria-label={
              animationFrames
                ? `Animation frame ${animationFrames.current} of ${animationFrames.total}. Open settings.`
                : 'Animation frame. Open settings.'
            }
            onClick={() => setSettingsPanelOpen(true)}
          >
            {animationFrames
              ? `${animationFrames.current} / ${animationFrames.total}`
              : '—'}
          </button>
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
                  <div className={styles.playerScrubRow}>
                    {!settingsPanelOpen ? (
                      <button
                        type="button"
                        className={styles.playerScrubTransportButton}
                        onClick={() => setSettingsPanelOpen(true)}
                        aria-label="Open Spine configuration"
                      >
                        <svg
                          className={styles.playerScrubTransportIcon}
                          viewBox="0 0 24 24"
                          aria-hidden
                        >
                          <path
                            fill="currentColor"
                            d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
                          />
                        </svg>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.playerScrubTransportButton}
                      disabled={scrubDisabled}
                      onClick={handlePlay}
                      aria-label="Play"
                      aria-pressed={playbackTransport === 'playing'}
                    >
                      <svg
                        className={styles.playerScrubTransportIcon}
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                      </svg>
                    </button>
                    <div className={styles.playerScrub}>
                      <div
                        className={styles.playerScrubTrack}
                        data-scrub-dragging={scrubDragging ? '' : undefined}
                      >
                        <button
                          type="button"
                          className={`${styles.playerHudChip} ${styles.playerAnimLabel}`}
                          title={
                            animations.length === 0 ? undefined : selectedAnimation
                          }
                          aria-label={
                            animations.length === 0
                              ? 'Loading animations. Open settings.'
                              : `Animation ${selectedAnimation}. Open settings.`
                          }
                          onClick={() => setSettingsPanelOpen(true)}
                        >
                          {animations.length === 0
                            ? 'Loading…'
                            : selectedAnimation || '—'}
                        </button>
                        <span
                          ref={scrubThumbLabelRef}
                          className={styles.playerScrubThumbLabel}
                          aria-hidden
                        >
                          {animationFrames?.current ?? '—'}
                        </span>
                        <input
                          ref={scrubRangeRef}
                          type="range"
                          className={styles.playerScrubRange}
                          style={scrubRangeStyle}
                          min={0}
                          max={1000}
                          step={1}
                          disabled={scrubDisabled}
                          value={scrubValue1000}
                          aria-label="Animation progress"
                          onPointerDown={handleScrubPointerDown}
                          onPointerUp={handleScrubPointerUp}
                          onPointerCancel={handleScrubPointerUp}
                          onChange={handleScrubChange}
                          onBlur={handleScrubBlur}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.playerScrubTransportButton}
                      disabled={scrubDisabled}
                      onClick={handlePause}
                      aria-label="Pause or resume"
                      aria-pressed={playbackTransport === 'paused'}
                    >
                      <svg
                        className={styles.playerScrubTransportIcon}
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
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
