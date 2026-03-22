import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pixi8SpinePlayer,
  type SpinePlaybackMode,
} from './SpinePlayer/SpinePlayer'
import { SettingsPanel } from './SettingsPanel/SettingsPanel'
import {
  classifySpineFiles,
  createSpineObjectUrls,
  getAtlasPageName,
} from './spine/loadSpineFiles'
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
  const [playbackMode, setPlaybackMode] = useState<SpinePlaybackMode>('loop')
  const [playbackNonce, setPlaybackNonce] = useState(0)

  const bumpPlayback = useCallback(() => {
    setPlaybackNonce((n) => n + 1)
  }, [])

  const handlePlayOnce = useCallback(() => {
    setPlaybackMode('once')
    bumpPlayback()
  }, [bumpPlayback])

  const handlePlayLoop = useCallback(() => {
    setPlaybackMode('loop')
    bumpPlayback()
  }, [bumpPlayback])

  const handlePlaybackStop = useCallback(() => {
    setPlaybackMode('stop')
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
      setPlaybackMode('loop')
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
          playbackMode={playbackMode}
          onPlayOnce={handlePlayOnce}
          onPlayLoop={handlePlayLoop}
          onPlaybackStop={handlePlaybackStop}
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
              playbackMode={playbackMode}
              playbackNonce={playbackNonce}
              spineScale={canvasScale}
              layoutResetToken={layoutResetToken}
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
