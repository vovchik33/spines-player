export type ClassifiedSpineFiles =
  | { ok: true; skeleton: File; atlas: File; textures: File[] }
  | { ok: false; message: string }

export function classifySpineFiles(files: File[]): ClassifiedSpineFiles {
  console.log('[loadSpineFiles] classifySpineFiles', {
    count: files.length,
    names: files.map((f) => f.name),
  })

  if (files.length < 3) {
    console.warn('[loadSpineFiles] classify failed: expected at least 3 files')
    return {
      ok: false,
      message:
        'Select at least 3 files: one skeleton (.json or .skel), one atlas (.atlas), and one or more images (.png, .jpg, or .webp).',
    }
  }

  const atlasFiles = files.filter((f) => f.name.toLowerCase().endsWith('.atlas'))
  const skeletonFiles = files.filter((f) => /\.(json|skel)$/i.test(f.name))
  const textures = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
  const recognizedCount =
    atlasFiles.length + skeletonFiles.length + textures.length

  if (
    atlasFiles.length !== 1 ||
    skeletonFiles.length !== 1 ||
    textures.length < 1 ||
    recognizedCount !== files.length
  ) {
    console.warn('[loadSpineFiles] classify failed', {
      atlasFiles: atlasFiles.length,
      skeletonFiles: skeletonFiles.length,
      textures: textures.length,
      recognizedCount,
      total: files.length,
    })
    return {
      ok: false,
      message:
        'Need exactly one .atlas file, exactly one skeleton (.json or .skel), and one or more images (.png, .jpg, .webp).',
    }
  }

  const atlas = atlasFiles[0]
  const skeleton = skeletonFiles[0]

  const set = new Set<File>(files)
  if (set.size !== files.length) {
    console.warn('[loadSpineFiles] classify failed: duplicate file references')
    return { ok: false, message: 'Selected files must be different files.' }
  }

  console.log('[loadSpineFiles] classify ok', {
    skeleton: skeleton.name,
    atlas: atlas.name,
    textures: textures.map((t) => t.name),
  })
  return { ok: true, skeleton, atlas, textures }
}

/** Page names are the first non-empty line at start and after blank lines. */
export async function getAtlasPageNames(atlasFile: File): Promise<string[]> {
  const text = await atlasFile.text()
  const lines = text.split(/\r?\n/)
  const pages: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (i === 0 || lines[i - 1].trim() === '') {
      pages.push(line)
    }
  }
  if (pages.length === 0) {
    throw new Error('Atlas file has no page names')
  }
  console.log('[loadSpineFiles] atlas page names', pages)
  return pages
}

function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

function pickTextureForPage(pageName: string, textures: File[]): File | null {
  const exact = textures.find((t) => t.name === pageName)
  if (exact) return exact
  const pageBase = fileBaseName(pageName)
  const baseMatch = textures.find((t) => fileBaseName(t.name) === pageBase)
  if (baseMatch) return baseMatch
  const lower = pageName.toLowerCase()
  const ci = textures.find((t) => t.name.toLowerCase() === lower)
  if (ci) return ci
  const lowerBase = pageBase.toLowerCase()
  return (
    textures.find((t) => fileBaseName(t.name).toLowerCase() === lowerBase) ?? null
  )
}

export function createSpineObjectUrls(classified: {
  skeleton: File
  atlas: File
  textures: File[]
  atlasPageNames: string[]
}): {
  skeletonUrl: string
  atlasUrl: string
  atlasImageMap: Record<string, string>
  revoke: () => void
} {
  const skeletonUrl = URL.createObjectURL(classified.skeleton)
  const atlasUrl = URL.createObjectURL(classified.atlas)
  const textureUrls: string[] = []
  const atlasImageMap: Record<string, string> = {}

  for (const pageName of classified.atlasPageNames) {
    const texture = pickTextureForPage(pageName, classified.textures)
    if (!texture) {
      throw new Error(
        `Atlas page "${pageName}" has no matching image file in selected textures: ${classified.textures
          .map((t) => t.name)
          .join(', ')}`,
      )
    }
    const textureUrl = URL.createObjectURL(texture)
    textureUrls.push(textureUrl)
    atlasImageMap[pageName] = textureUrl
  }

  console.log('[loadSpineFiles] createSpineObjectUrls', {
    atlasPageNames: classified.atlasPageNames,
    mapKeys: Object.keys(atlasImageMap),
  })

  return {
    skeletonUrl,
    atlasUrl,
    atlasImageMap,
    revoke: () => {
      console.log('[loadSpineFiles] revoke object URLs')
      URL.revokeObjectURL(skeletonUrl)
      URL.revokeObjectURL(atlasUrl)
      for (const textureUrl of textureUrls) {
        URL.revokeObjectURL(textureUrl)
      }
    },
  }
}
