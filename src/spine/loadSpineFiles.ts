export type ClassifiedSpineFiles =
  | { ok: true; skeleton: File; atlas: File; texture: File }
  | { ok: false; message: string }

export function classifySpineFiles(files: File[]): ClassifiedSpineFiles {
  console.log('[loadSpineFiles] classifySpineFiles', {
    count: files.length,
    names: files.map((f) => f.name),
  })

  if (files.length !== 3) {
    console.warn('[loadSpineFiles] classify failed: expected 3 files')
    return {
      ok: false,
      message:
        'Select exactly 3 files: skeleton (.json or .skel), atlas (.atlas), and texture (.png, .jpg, or .webp).',
    }
  }

  const atlas = files.find((f) => f.name.toLowerCase().endsWith('.atlas'))
  const skeleton = files.find((f) => /\.(json|skel)$/i.test(f.name))
  const texture = files.find((f) => /\.(png|jpe?g|webp)$/i.test(f.name))

  if (!atlas || !skeleton || !texture) {
    console.warn('[loadSpineFiles] classify failed: missing .atlas / skeleton / image', {
      hasAtlas: !!atlas,
      hasSkeleton: !!skeleton,
      hasTexture: !!texture,
    })
    return {
      ok: false,
      message:
        'Need one .atlas file, one skeleton (.json or .skel), and one image (.png, .jpg, .webp).',
    }
  }

  const set = new Set<File>([atlas, skeleton, texture])
  if (set.size !== 3) {
    console.warn('[loadSpineFiles] classify failed: duplicate file references')
    return { ok: false, message: 'The three files must be three different files.' }
  }

  console.log('[loadSpineFiles] classify ok', {
    skeleton: skeleton.name,
    atlas: atlas.name,
    texture: texture.name,
  })
  return { ok: true, skeleton, atlas, texture }
}

/** First non-empty line of an atlas = texture page name (e.g. `hero.png`). */
export async function getAtlasPageName(atlasFile: File): Promise<string> {
  const text = await atlasFile.text()
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0)
  if (!line) {
    throw new Error('Atlas file has no page name line')
  }
  const page = line.trim()
  console.log('[loadSpineFiles] atlas page name', page)
  return page
}

export function createSpineObjectUrls(classified: {
  skeleton: File
  atlas: File
  texture: File
  atlasPageName: string
}): {
  skeletonUrl: string
  atlasUrl: string
  atlasImageMap: Record<string, string>
  revoke: () => void
} {
  const skeletonUrl = URL.createObjectURL(classified.skeleton)
  const atlasUrl = URL.createObjectURL(classified.atlas)
  const textureUrl = URL.createObjectURL(classified.texture)
  const atlasImageMap: Record<string, string> = {
    [classified.atlasPageName]: textureUrl,
  }

  console.log('[loadSpineFiles] createSpineObjectUrls', {
    atlasPageName: classified.atlasPageName,
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
      URL.revokeObjectURL(textureUrl)
    },
  }
}
