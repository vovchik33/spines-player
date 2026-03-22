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
  SPINE_VIEW_SCALE_MAX,
  SPINE_VIEW_SCALE_MIN,
} from './spineViewScale'
import styles from './App.module.scss'

const INITIAL_CANVAS_SCALE = 1

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
  useEffect(() => {
    playbackTransportRef.current = playbackTransport
  }, [playbackTransport])

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

  /** Pause when playing; press again to resume (same as Space). */
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
      if (e.code !== 'Space' || e.repeat) return
      if (isEditableKeyTarget(e.target)) return
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

  const applySpineScaleDelta = useCallback((delta: number) => {
    setCanvasScale((s) =>
      Math.min(
        SPINE_VIEW_SCALE_MAX,
        Math.max(SPINE_VIEW_SCALE_MIN, s + delta),
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
              spineScale={canvasScale}
              layoutResetToken={layoutResetToken}
              onSpineScaleDelta={applySpineScaleDelta}
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
