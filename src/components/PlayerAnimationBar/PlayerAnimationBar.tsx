import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react'
import type {
  Pixi8SpinePlayerHandle,
  SpineAnimationFrameInfo,
  SpinePlaybackTransport,
} from '../SpinePlayer/SpinePlayer'
import appStyles from '../../App.module.scss'
import styles from './PlayerAnimationBar.module.scss'

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

export interface PlayerAnimationBarProps {
  spinePlayerRef: RefObject<Pixi8SpinePlayerHandle | null>
  animations: string[]
  selectedAnimation: string
  onAnimationChange: (name: string) => void
  animationFrames: SpineAnimationFrameInfo | null
  playbackTransport: SpinePlaybackTransport
  onPlaybackTransportChange: (t: SpinePlaybackTransport) => void
  playbackProgress1000: number
  onScrubCommit: (value1000: number) => void
  settingsPanelOpen: boolean
  onOpenSettings: () => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onScrubDraggingChange: (dragging: boolean) => void
}

export function PlayerAnimationBar({
  spinePlayerRef,
  animations,
  selectedAnimation,
  onAnimationChange,
  animationFrames,
  playbackTransport,
  onPlaybackTransportChange,
  playbackProgress1000,
  onScrubCommit,
  settingsPanelOpen,
  onOpenSettings,
  onPlay,
  onPause,
  onStop,
  onScrubDraggingChange,
}: PlayerAnimationBarProps) {
  const playbackTransportRef = useRef(playbackTransport)
  useEffect(() => {
    playbackTransportRef.current = playbackTransport
  }, [playbackTransport])

  const scrubRangeRef = useRef<HTMLInputElement>(null)
  const scrubThumbLabelRef = useRef<HTMLSpanElement>(null)
  const [scrubUiValue, setScrubUiValue] = useState(0)
  const [scrubDragging, setScrubDragging] = useState(false)
  const scrubDraggingRef = useRef(false)
  const lastScrubValue1000Ref = useRef(0)

  useEffect(() => {
    scrubDraggingRef.current = scrubDragging
    onScrubDraggingChange(scrubDragging)
  }, [scrubDragging, onScrubDraggingChange])

  const scrubDisabled = animations.length === 0

  const applyScrubValue = useCallback(
    (value1000: number) => {
      const clamped = Math.max(0, Math.min(1000, Math.round(value1000)))
      lastScrubValue1000Ref.current = clamped
      setScrubUiValue(clamped)
      spinePlayerRef.current?.seekTrack0ToNormalized(clamped / 1000)
    },
    [spinePlayerRef],
  )

  const finishScrubInteraction = useCallback(
    (value1000: number) => {
      if (!scrubDraggingRef.current) return
      const v = Math.max(0, Math.min(1000, Math.round(value1000)))
      lastScrubValue1000Ref.current = v
      setScrubUiValue(v)
      scrubDraggingRef.current = false
      setScrubDragging(false)
      onScrubCommit(v)
    },
    [onScrubCommit],
  )

  useEffect(() => {
    if (playbackTransport !== 'stopped') return
    if (!scrubDraggingRef.current) return
    finishScrubInteraction(lastScrubValue1000Ref.current)
  }, [playbackTransport, finishScrubInteraction])

  const handleScrubPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (scrubDisabled) return
    if (playbackTransport === 'playing' || playbackTransport === 'stopped') {
      onPlaybackTransportChange('paused')
    }
    scrubDraggingRef.current = true
    setScrubDragging(true)
    const target = e.currentTarget
    const nextValue = Number(target.value)
    target.setPointerCapture(e.pointerId)
    requestAnimationFrame(() => applyScrubValue(nextValue))
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
      onPlaybackTransportChange('paused')
      scrubDraggingRef.current = true
      setScrubDragging(true)
    }
    applyScrubValue(Number(e.target.value))
  }

  const handleScrubBlur = () => {
    if (!scrubDraggingRef.current) return
    finishScrubInteraction(lastScrubValue1000Ref.current)
  }

  const goAdjacentAnimation = useCallback(
    (delta: number) => {
      if (animations.length === 0) return
      const raw = selectedAnimation
      const current = animations.includes(raw) ? raw : animations[0]
      const idx = animations.indexOf(current)
      const nextIdx = (idx + delta + animations.length) % animations.length
      onAnimationChange(animations[nextIdx])
    },
    [animations, selectedAnimation, onAnimationChange],
  )

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

  return (
    <div
      className={styles.root}
      data-player-animation-bar
      role="group"
      aria-label="Canvas animation"
    >
      <button
        type="button"
        className={styles.navButton}
        disabled={animations.length === 0}
        onClick={() => goAdjacentAnimation(-1)}
        aria-label="Previous animation"
      >
        ←
      </button>
      <button
        type="button"
        className={styles.navButton}
        disabled={animations.length === 0}
        onClick={() => goAdjacentAnimation(1)}
        aria-label="Next animation"
      >
        →
      </button>
      <div className={styles.barBottom}>
        <div className={styles.barStrip}>
          <div className={styles.scrubRow}>
            {!settingsPanelOpen ? (
              <button
                type="button"
                className={styles.transportButton}
                onClick={onOpenSettings}
                aria-label="Open Spine configuration"
              >
                <svg
                  className={styles.transportIcon}
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
              className={styles.transportButton}
              disabled={scrubDisabled}
              onClick={playbackTransport === 'playing' ? onPause : onPlay}
              aria-label={
                playbackTransport === 'playing' ? 'Pause or resume' : 'Play'
              }
              aria-pressed={playbackTransport === 'playing'}
            >
              {playbackTransport === 'playing' ? (
                <svg
                  className={styles.transportIcon}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg
                  className={styles.transportIcon}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" fill="currentColor" />
                </svg>
              )}
            </button>
            <div className={styles.scrub}>
              <div
                className={styles.scrubTrack}
                data-scrub-dragging={scrubDragging ? '' : undefined}
              >
                <button
                  type="button"
                  className={`${appStyles.playerHudChip} ${styles.animLabelAnchor}`}
                  title={
                    animations.length === 0 ? undefined : selectedAnimation
                  }
                  aria-label={
                    animations.length === 0
                      ? 'Loading animations. Open settings.'
                      : `Animation ${selectedAnimation}. Open settings.`
                  }
                  onClick={onOpenSettings}
                >
                  {animations.length === 0
                    ? 'Loading…'
                    : selectedAnimation || '—'}
                </button>
                <span
                  ref={scrubThumbLabelRef}
                  className={styles.thumbLabel}
                  aria-hidden
                >
                  {animationFrames?.current ?? '—'}
                </span>
                <input
                  ref={scrubRangeRef}
                  type="range"
                  className={styles.scrubRange}
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
              className={styles.transportButton}
              disabled={scrubDisabled}
              onClick={onStop}
              aria-label="Stop"
              aria-pressed={playbackTransport === 'stopped'}
            >
              <svg
                className={styles.transportIcon}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <rect x="6" y="6" width="12" height="12" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
