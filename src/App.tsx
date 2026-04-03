import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  Pixi8SpinePlayer,
  SPINE_FRAME_COUNTER_FPS,
  type Pixi8SpinePlayerHandle,
  type SpineAnimationFrameInfo,
  type SpinePlaybackTransport,
} from './components/SpinePlayer/SpinePlayer'
import { PlayerAnimationBar } from './components/PlayerAnimationBar/PlayerAnimationBar'
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel'
import {
  classifySpineFiles,
  createSpineObjectUrls,
  getAtlasPageNames,
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
const INITIAL_PLAYER_BACKGROUND_COLOR = '#0a0a0e'
const PLAYER_BACKGROUND_SCALE_MIN = 0.5
const PLAYER_BACKGROUND_SCALE_MAX = 4
const SETTINGS_PANEL_WIDTH_STORAGE_KEY = 'spines-player:settings-panel-width'
const SETTINGS_PANEL_WIDTH_MIN = 240
const SETTINGS_PANEL_WIDTH_MAX = 520
const SETTINGS_PANEL_WIDTH_DEFAULT = 280
const SETTINGS_PANEL_HEIGHT_STORAGE_KEY = 'spines-player:settings-panel-height'
const SETTINGS_PANEL_HEIGHT_MIN = 280

function getSettingsPanelMaxWidth(): number {
  if (typeof window === 'undefined') return SETTINGS_PANEL_WIDTH_MAX
  return Math.max(SETTINGS_PANEL_WIDTH_MAX, Math.floor(window.innerWidth * 0.8))
}

function getSettingsPanelDefaultHeight(): number {
  if (typeof window === 'undefined') return 640
  return Math.floor(window.innerHeight * 0.8)
}

function getSettingsPanelMaxHeight(): number {
  if (typeof window === 'undefined') return 960
  return Math.floor(window.innerHeight * 0.95)
}

type CustomSpinePack = {
  displayName: string
  skeletonUrl: string
  atlasUrl: string
  atlasImageMap: Record<string, string>
  revoke: () => void
}

type PlayerBackgroundImage = {
  name: string
  url: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function skeletonFileDisplayName(file: File): string {
  return file.name.replace(/\.(json|skel)$/i, '') || file.name
}

export default function App() {
  const base = import.meta.env.BASE_URL
  const defaultSkeletonUrl = `${base}spines/cat/Cat.json`
  const defaultAtlasUrl = `${base}spines/cat/Cat.atlas`

  const [animation, setAnimation] = useState('1_Idle')
  const [animations, setAnimations] = useState<string[]>([])
  const [animationSequence, setAnimationSequence] = useState<string[]>([])
  const [animationSequenceIndex, setAnimationSequenceIndex] = useState(0)
  const [playbackTransport, setPlaybackTransport] =
    useState<SpinePlaybackTransport>('playing')
  const [animationLoop, setAnimationLoop] = useState(true)
  const [playbackNonce, setPlaybackNonce] = useState(0)
  const [scrubDragging, setScrubDragging] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(true)
  const [settingsPanelWidth, setSettingsPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return SETTINGS_PANEL_WIDTH_DEFAULT
    const raw = window.localStorage.getItem(SETTINGS_PANEL_WIDTH_STORAGE_KEY)
    const n = Number(raw)
    if (!Number.isFinite(n)) return SETTINGS_PANEL_WIDTH_DEFAULT
    const max = getSettingsPanelMaxWidth()
    return Math.max(
      SETTINGS_PANEL_WIDTH_MIN,
      Math.min(max, Math.round(n)),
    )
  })
  const settingsPanelResizeRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)
  const settingsPanelResizePointerIdRef = useRef<number | null>(null)
  const [settingsPanelHeight, setSettingsPanelHeight] = useState(() => {
    if (typeof window === 'undefined') return getSettingsPanelDefaultHeight()
    const raw = window.localStorage.getItem(SETTINGS_PANEL_HEIGHT_STORAGE_KEY)
    const n = Number(raw)
    const max = getSettingsPanelMaxHeight()
    const fallback = getSettingsPanelDefaultHeight()
    if (!Number.isFinite(n)) return Math.max(SETTINGS_PANEL_HEIGHT_MIN, Math.min(max, fallback))
    return Math.max(SETTINGS_PANEL_HEIGHT_MIN, Math.min(max, Math.round(n)))
  })
  const settingsPanelVerticalResizeRef = useRef<{
    startY: number
    startHeight: number
  } | null>(null)

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
    window.localStorage.setItem(
      SETTINGS_PANEL_WIDTH_STORAGE_KEY,
      String(settingsPanelWidth),
    )
  }, [settingsPanelWidth])

  useEffect(() => {
    window.localStorage.setItem(
      SETTINGS_PANEL_HEIGHT_STORAGE_KEY,
      String(settingsPanelHeight),
    )
  }, [settingsPanelHeight])

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
    if (animationSequence.length > 0 && prev === 'stopped') {
      const first = animationSequence[0]
      if (first) {
        setAnimationSequenceIndex(0)
        setAnimation(first)
      }
    }
    setPlaybackTransport('playing')
    if (prev === 'playing') {
      bumpPlayback()
    }
  }, [animationSequence, bumpPlayback])

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
  }, [])

  const handleNonLoopAnimationComplete = useCallback(() => {
    if (animationSequence.length > 0) {
      const nextIndex = animationSequenceIndex + 1
      const nextAnimation = animationSequence[nextIndex]
      if (nextAnimation) {
        setAnimationSequenceIndex(nextIndex)
        setAnimation(nextAnimation)
        // Force a restart even when next item has the same animation name.
        setPlaybackNonce((n) => n + 1)
        return
      }
    }
    setPlaybackTransport('stopped')
  }, [animationSequence, animationSequenceIndex])

  const [canvasScale, setCanvasScale] = useState(INITIAL_CANVAS_SCALE)
  const [animationSpeed, setAnimationSpeed] = useState(INITIAL_ANIMATION_SPEED)
  const [playerBackgroundColor, setPlayerBackgroundColor] = useState(
    INITIAL_PLAYER_BACKGROUND_COLOR,
  )
  const [playerBackgroundImage, setPlayerBackgroundImage] =
    useState<PlayerBackgroundImage | null>(null)
  const [playerBackgroundScale, setPlayerBackgroundScale] = useState(1)
  const [playerBackgroundOffset, setPlayerBackgroundOffset] = useState({
    x: 0,
    y: 0,
  })
  const [layoutResetToken, setLayoutResetToken] = useState(0)
  const [customSpine, setCustomSpine] = useState<CustomSpinePack | null>(null)
  const [spineLoadError, setSpineLoadError] = useState<string | null>(null)
  const [spineJsonRoot, setSpineJsonRoot] = useState<Record<string, unknown> | null>(
    null,
  )
  const [spineJsonError, setSpineJsonError] = useState<string | null>(null)

  const customSpineRef = useRef<CustomSpinePack | null>(null)
  const playerBackgroundImageUrlRef = useRef<string | null>(null)
  const playerBackgroundDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)
  const [playerBackgroundDragging, setPlayerBackgroundDragging] = useState(false)

  useEffect(() => {
    customSpineRef.current = customSpine
  }, [customSpine])

  useEffect(() => {
    playerBackgroundImageUrlRef.current = playerBackgroundImage?.url ?? null
  }, [playerBackgroundImage])

  useEffect(() => {
    if (customSpine) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(defaultSkeletonUrl)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const parsed: unknown = await res.json()
        if (!isRecord(parsed)) {
          throw new Error('Invalid JSON root')
        }
        if (cancelled) return
        setSpineJsonRoot(parsed)
        setSpineJsonError(null)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Failed to load JSON'
        console.warn('[App] Could not load default Spine JSON tree', msg)
        setSpineJsonRoot(null)
        setSpineJsonError(`Could not load Spine JSON tree: ${msg}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [customSpine, defaultSkeletonUrl])

  useEffect(() => {
    return () => {
      if (customSpineRef.current) {
        console.log('[App] unmount: revoke custom spine object URLs')
      }
      customSpineRef.current?.revoke()
    }
  }, [])

  useEffect(() => {
    return () => {
      const imageUrl = playerBackgroundImageUrlRef.current
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [])

  useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const el = target.closest('input, textarea, [contenteditable="true"]')
      if (!el) return false
      if (el instanceof HTMLTextAreaElement) return true
      if (el instanceof HTMLInputElement) {
        const t = (el.type || 'text').toLowerCase()
        return (
          t === 'text' ||
          t === 'search' ||
          t === 'email' ||
          t === 'url' ||
          t === 'tel' ||
          t === 'password' ||
          t === 'number'
        )
      }
      return el.getAttribute('contenteditable') === 'true'
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTextEntryTarget(e.target)) return

      if (e.code === 'KeyP' || e.code === 'Space') {
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

      if (e.code === 'KeyS') {
        if (e.repeat) return
        e.preventDefault()
        setSettingsPanelOpen((v) => !v)
        return
      }

      if (e.code === 'KeyR') {
        if (e.repeat) return
        e.preventDefault()
        if (e.shiftKey) {
          setPlayerBackgroundScale(1)
          setPlayerBackgroundOffset({ x: 0, y: 0 })
          return
        }
        setCanvasScale(INITIAL_CANVAS_SCALE)
        setAnimationSpeed(INITIAL_ANIMATION_SPEED)
        setLayoutResetToken((n) => n + 1)
        return
      }

      // Animation speed: ArrowUp / ArrowDown (`code` is layout-independent).
      if (e.code === 'ArrowUp') {
        e.preventDefault()
        setAnimationSpeed((s) =>
          Math.min(
            SPINE_ANIMATION_SPEED_MAX,
            s + SPINE_ANIMATION_SPEED_STEP,
          ),
        )
        return
      }
      if (e.code === 'ArrowDown') {
        e.preventDefault()
        setAnimationSpeed((s) =>
          Math.max(
            SPINE_ANIMATION_SPEED_MIN,
            s - SPINE_ANIMATION_SPEED_STEP,
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

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const names = animationsRef.current
        if (names.length === 0) return
        e.preventDefault()
        const raw = animationRef.current
        const current = names.includes(raw) ? raw : names[0]
        const idx = names.indexOf(current)
        const delta = e.code === 'ArrowRight' ? 1 : -1
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
      if (/\.json$/i.test(r.skeleton.name)) {
        try {
          const parsed: unknown = JSON.parse(await r.skeleton.text())
          if (!isRecord(parsed)) {
            throw new Error('JSON root must be an object')
          }
          setSpineJsonRoot(parsed)
          setSpineJsonError(null)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Invalid JSON'
          setSpineJsonRoot(null)
          setSpineJsonError(`Could not parse skeleton JSON: ${msg}`)
        }
      } else {
        setSpineJsonRoot(null)
        setSpineJsonError(
          'Spine tree preview is available for .json skeleton files only.',
        )
      }

      const atlasPageNames = await getAtlasPageNames(r.atlas)
      const urls = createSpineObjectUrls({
        skeleton: r.skeleton,
        atlas: r.atlas,
        textures: r.textures,
        atlasPageNames,
      })
      const displayName = skeletonFileDisplayName(r.skeleton)
      const next: CustomSpinePack = {
        ...urls,
        displayName,
      }
      console.log('[App] Load Spine: applying pack', { displayName, atlasPageNames })
      setAnimations([])
      setAnimationSequence([])
      setAnimationSequenceIndex(0)
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
    setLayoutResetToken((n) => n + 1)
  }

  const resetAnimationSpeed = useCallback(() => {
    setAnimationSpeed(INITIAL_ANIMATION_SPEED)
  }, [])

  const handleSettingsResizeStart = useCallback(
    (clientX: number) => {
      settingsPanelResizeRef.current = {
        startX: clientX,
        startWidth: settingsPanelWidth,
      }
    },
    [settingsPanelWidth],
  )

  const handleSettingsResizeMove = useCallback((clientX: number) => {
    const drag = settingsPanelResizeRef.current
    if (!drag) return
    const delta = clientX - drag.startX
    const max = getSettingsPanelMaxWidth()
    const next = Math.max(
      SETTINGS_PANEL_WIDTH_MIN,
      Math.min(max, Math.round(drag.startWidth + delta)),
    )
    setSettingsPanelWidth(next)
  }, [])

  const handleSettingsResizeEnd = useCallback(() => {
    settingsPanelResizeRef.current = null
  }, [])

  const handleSettingsVerticalResizeStart = useCallback(
    (clientY: number) => {
      settingsPanelVerticalResizeRef.current = {
        startY: clientY,
        startHeight: settingsPanelHeight,
      }
    },
    [settingsPanelHeight],
  )

  const handleSettingsVerticalResizeMove = useCallback((clientY: number) => {
    const drag = settingsPanelVerticalResizeRef.current
    if (!drag) return
    const delta = drag.startY - clientY
    const max = getSettingsPanelMaxHeight()
    const next = Math.max(
      SETTINGS_PANEL_HEIGHT_MIN,
      Math.min(max, Math.round(drag.startHeight + delta)),
    )
    setSettingsPanelHeight(next)
  }, [])

  const handleSettingsVerticalResizeEnd = useCallback(() => {
    settingsPanelVerticalResizeRef.current = null
  }, [])

  const handlePlayerBackgroundImageChange = useCallback((file: File | null) => {
    setPlayerBackgroundScale(1)
    setPlayerBackgroundOffset({ x: 0, y: 0 })
    setPlayerBackgroundImage((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.url)
      }
      if (!file) return null
      if (!file.type.startsWith('image/')) {
        console.warn('[App] Background image rejected: not an image file', {
          name: file.name,
          type: file.type,
        })
        return null
      }
      const url = URL.createObjectURL(file)
      return { name: file.name, url }
    })
  }, [])

  const handlePlayerWheelCapture = useCallback(
    (e: ReactWheelEvent<HTMLElement>) => {
      if (!playerBackgroundImage || !e.shiftKey) return
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      e.stopPropagation()
      bumpPlayerChrome()
      const factor = Math.exp(-delta * 0.0015)
      setPlayerBackgroundScale((s) =>
        Math.min(
          PLAYER_BACKGROUND_SCALE_MAX,
          Math.max(PLAYER_BACKGROUND_SCALE_MIN, s * factor),
        ),
      )
    },
    [playerBackgroundImage, bumpPlayerChrome],
  )

  const handlePlayerPointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      bumpPlayerChrome()
      if (!playerBackgroundImage || !e.shiftKey || e.button !== 0) return
      playerBackgroundDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startOffsetX: playerBackgroundOffset.x,
        startOffsetY: playerBackgroundOffset.y,
      }
      setPlayerBackgroundDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
      e.stopPropagation()
    },
    [bumpPlayerChrome, playerBackgroundImage, playerBackgroundOffset],
  )

  const handlePlayerPointerMoveCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = playerBackgroundDragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      setPlayerBackgroundOffset({
        x: drag.startOffsetX + dx,
        y: drag.startOffsetY + dy,
      })
      e.preventDefault()
      e.stopPropagation()
    },
    [],
  )

  const endPlayerBackgroundDrag = useCallback(() => {
    playerBackgroundDragRef.current = null
    setPlayerBackgroundDragging(false)
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

  const handleAddAnimationToSequence = useCallback(() => {
    if (!selectedAnimation) return
    setAnimationSequence((prev) => [...prev, selectedAnimation])
  }, [selectedAnimation])

  const handleClearAnimationSequence = useCallback(() => {
    setAnimationSequence([])
    setAnimationSequenceIndex(0)
  }, [])

  const handleCloneSequenceItem = useCallback((index: number) => {
    setAnimationSequence((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const next = [...prev]
      next.splice(index + 1, 0, prev[index])
      return next
    })
    setAnimationSequenceIndex((prevIndex) =>
      prevIndex > index ? prevIndex + 1 : prevIndex,
    )
  }, [])

  const handleDeleteSequenceItem = useCallback((index: number) => {
    setAnimationSequence((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const next = [...prev]
      next.splice(index, 1)

      setAnimationSequenceIndex((prevIndex) => {
        if (next.length === 0) return 0
        if (prevIndex < index) return prevIndex
        if (prevIndex > index) return prevIndex - 1
        return Math.min(index, next.length - 1)
      })

      return next
    })
  }, [])

  const handleMoveSequenceItemUp = useCallback((index: number) => {
    if (index <= 0) return
    setAnimationSequence((prev) => {
      if (index >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index - 1]
      next[index - 1] = next[index]
      next[index] = tmp
      return next
    })
    setAnimationSequenceIndex((prevIndex) => {
      if (prevIndex === index) return prevIndex - 1
      if (prevIndex === index - 1) return prevIndex + 1
      return prevIndex
    })
  }, [])

  const handleMoveSequenceItemDown = useCallback(
    (index: number) => {
      setAnimationSequence((prev) => {
        if (index < 0 || index >= prev.length - 1) return prev
        const next = [...prev]
        const tmp = next[index + 1]
        next[index + 1] = next[index]
        next[index] = tmp
        return next
      })
      setAnimationSequenceIndex((prevIndex) => {
        if (prevIndex === index) return prevIndex + 1
        if (prevIndex === index + 1) return prevIndex - 1
        return prevIndex
      })
    },
    [],
  )

  const handleInsertSequenceItem = useCallback(
    (fromIndex: number, insertIndex: number) => {
      setAnimationSequence((prev) => {
        if (
          fromIndex < 0 ||
          insertIndex < 0 ||
          fromIndex >= prev.length ||
          insertIndex > prev.length
        ) {
          return prev
        }
        const adjustedInsert =
          insertIndex > fromIndex ? insertIndex - 1 : insertIndex
        if (adjustedInsert === fromIndex) return prev
        const next = [...prev]
        const moved = next[fromIndex]
        next.splice(fromIndex, 1)
        next.splice(adjustedInsert, 0, moved)
        return next
      })
      setAnimationSequenceIndex((prevIndex) => {
        const adjustedInsert =
          insertIndex > fromIndex ? insertIndex - 1 : insertIndex
        if (prevIndex === fromIndex) return adjustedInsert
        if (prevIndex > fromIndex) {
          prevIndex -= 1
        }
        if (prevIndex >= adjustedInsert) {
          prevIndex += 1
        }
        return prevIndex
      })
    },
    [],
  )

  useEffect(() => {
    if (animationSequence.length === 0) {
      if (animationSequenceIndex !== 0) {
        setAnimationSequenceIndex(0)
      }
      return
    }
    if (animationSequenceIndex >= animationSequence.length) {
      setAnimationSequenceIndex(animationSequence.length - 1)
      return
    }

    // Keep index stable for duplicate names while current sequence item already matches.
    if (animationSequence[animationSequenceIndex] === animation) {
      return
    }

    const idx = animationSequence.indexOf(animation)
    if (idx >= 0 && idx !== animationSequenceIndex) {
      setAnimationSequenceIndex(idx)
    }
  }, [animation, animationSequence, animationSequenceIndex])

  const sequenceActive = animationSequence.length > 0
  const effectiveAnimationLoop = sequenceActive ? false : animationLoop

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
  const scrubDraggingRef = useRef(false)
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

  const handleScrubCommit = useCallback((value1000: number) => {
    if (rafProgressRef.current) {
      cancelAnimationFrame(rafProgressRef.current)
      rafProgressRef.current = 0
    }
    const v = Math.max(0, Math.min(1000, Math.round(value1000)))
    pendingProgressRef.current = v / 1000
    setPlaybackProgress1000(v)
  }, [])

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
              animationSequence={animationSequence}
              animationSequenceIndex={animationSequenceIndex}
              onAddAnimationToSequence={handleAddAnimationToSequence}
              onClearAnimationSequence={handleClearAnimationSequence}
              onCloneSequenceItem={handleCloneSequenceItem}
              onDeleteSequenceItem={handleDeleteSequenceItem}
              onMoveSequenceItemUp={handleMoveSequenceItemUp}
              onMoveSequenceItemDown={handleMoveSequenceItemDown}
              onInsertSequenceItem={handleInsertSequenceItem}
              playbackTransport={playbackTransport}
              animationLoop={effectiveAnimationLoop}
              onAnimationLoopChange={setAnimationLoop}
              sequenceActive={sequenceActive}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              canvasScale={canvasScale}
              onCanvasScaleChange={setCanvasScale}
              animationSpeed={animationSpeed}
              onAnimationSpeedChange={setAnimationSpeed}
              onResetAnimationSpeed={resetAnimationSpeed}
              playerBackgroundColor={playerBackgroundColor}
              onPlayerBackgroundColorChange={setPlayerBackgroundColor}
              playerBackgroundImageName={playerBackgroundImage?.name ?? null}
              onPlayerBackgroundImageChange={handlePlayerBackgroundImageChange}
              onResetLayout={resetLayout}
              onLoadSpineFiles={handleLoadSpineFiles}
              spineLoadError={spineLoadError}
              loadedSpineName={loadedSpineName}
              hasCustomSpineLoaded={customSpine !== null}
              spineJsonRoot={spineJsonRoot}
              spineJsonError={spineJsonError}
              panelWidth={settingsPanelWidth}
              panelHeight={settingsPanelHeight}
              onVerticalResizeStart={handleSettingsVerticalResizeStart}
              onVerticalResizeMove={handleSettingsVerticalResizeMove}
              onVerticalResizeEnd={handleSettingsVerticalResizeEnd}
              onClose={() => setSettingsPanelOpen(false)}
            />
            <button
              type="button"
              className={styles.settingsResizeHandle}
              aria-label="Resize settings panel"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                settingsPanelResizePointerIdRef.current = e.pointerId
                e.currentTarget.setPointerCapture(e.pointerId)
                handleSettingsResizeStart(e.clientX)
                e.preventDefault()
              }}
              onPointerMove={(e) => {
                if (settingsPanelResizePointerIdRef.current !== e.pointerId) return
                handleSettingsResizeMove(e.clientX)
              }}
              onPointerUp={(e) => {
                if (settingsPanelResizePointerIdRef.current !== e.pointerId) return
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
                settingsPanelResizePointerIdRef.current = null
                handleSettingsResizeEnd()
              }}
              onPointerCancel={(e) => {
                if (settingsPanelResizePointerIdRef.current !== e.pointerId) return
                settingsPanelResizePointerIdRef.current = null
                handleSettingsResizeEnd()
              }}
              onLostPointerCapture={() => {
                settingsPanelResizePointerIdRef.current = null
                handleSettingsResizeEnd()
              }}
            />
          </>
        )}
        <main
          className={`${styles.player}${
            isCoarsePointer && !touchChromeVisible
              ? ` ${styles.playerTouchChromeHidden}`
              : ''
          }`}
          style={{
            backgroundColor: playerBackgroundColor,
            backgroundImage: playerBackgroundImage
              ? `url("${playerBackgroundImage.url}")`
              : undefined,
            backgroundSize: playerBackgroundImage
              ? `${(playerBackgroundScale * 100).toFixed(2)}%`
              : undefined,
            backgroundPosition: playerBackgroundImage
              ? `calc(50% + ${playerBackgroundOffset.x}px) calc(50% + ${playerBackgroundOffset.y}px)`
              : undefined,
            backgroundRepeat: 'no-repeat',
            cursor: playerBackgroundDragging ? 'grabbing' : undefined,
          }}
          data-player
          onWheelCapture={handlePlayerWheelCapture}
          onPointerDownCapture={handlePlayerPointerDownCapture}
          onPointerMoveCapture={handlePlayerPointerMoveCapture}
          onPointerUpCapture={(e) => {
            const drag = playerBackgroundDragRef.current
            if (!drag || drag.pointerId !== e.pointerId) return
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
            endPlayerBackgroundDrag()
          }}
          onPointerCancelCapture={(e) => {
            const drag = playerBackgroundDragRef.current
            if (!drag || drag.pointerId !== e.pointerId) return
            endPlayerBackgroundDrag()
          }}
          onLostPointerCapture={() => endPlayerBackgroundDrag()}
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
              animationLoop={effectiveAnimationLoop}
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
              onNonLoopAnimationComplete={handleNonLoopAnimationComplete}
            />
            <PlayerAnimationBar
              spinePlayerRef={spinePlayerRef}
              animations={animations}
              selectedAnimation={selectedAnimation}
              onAnimationChange={setAnimation}
              animationFrames={animationFrames}
              playbackTransport={playbackTransport}
              onPlaybackTransportChange={setPlaybackTransport}
              playbackProgress1000={playbackProgress1000}
              onScrubCommit={handleScrubCommit}
              settingsPanelOpen={settingsPanelOpen}
              onOpenSettings={() => setSettingsPanelOpen(true)}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onScrubDraggingChange={setScrubDragging}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
