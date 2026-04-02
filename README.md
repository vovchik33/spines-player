# spines-player

Web viewer for [Spine](http://esotericsoftware.com/) skeletal animations: load skeleton data, atlas, and one or more atlas page images; then preview clips, playback, scale, speed, and background transforms.

Built with **React**, **Pixi.js v8**, and **@esotericsoftware/spine-pixi-v8**.

## Requirements

- Node.js (for local dev)

## Scripts


| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Vite dev server with HMR            |
| `npm run build`   | TypeScript check + production build |
| `npm run preview` | Serve built `dist/` output          |
| `npm run lint`    | ESLint                              |


## Layout

- **Settings panel** on the left (desktop) or bottom sheet (tall/narrow screens).
- **Player area** on the right with the Spine canvas and HUD chips.
- Settings panel is resizable:
  - horizontal drag handle on desktop
  - top drag handle in bottom-sheet mode

## Loading Spine files

Use **Open...** in settings and select files in one pick:

- exactly one skeleton: `.json` or `.skel`
- exactly one atlas: `.atlas`
- one or more textures: `.png`, `.jpg`, `.jpeg`, `.webp`

Multi-page atlases are supported (atlas page names are matched to selected images).

If the selection is invalid, the panel shows an error with details.

When a new pack is loaded, the app resets:

- Spine scale to default
- animation speed to `1x`
- playback loop enabled and transport set to playing

## Default sample

If no custom files are loaded, the app uses bundled **Cat** assets from `public/spines/cat/` (resolved through Vite `base`).

## Playback and animation controls

- **Animation** dropdown lists clips from the loaded skeleton.
- **Play** restarts or starts current clip.
- **Pause** toggles paused/playing state.
- **Stop** seeks current clip to first frame and stops playback.
- **Loop animation** toggles loop mode for track 0.

## Scale and speed

- Spine scale: `0.1x` to `3x` (step `0.05`)
- Animation speed: `0.1x` to `3x` (step `0.05`)

Reset buttons:

- **Spine scale Reset**: resets spine scale + pan/layout transform
- **Animation speed Reset**: resets only animation speed to `1x`

## Background controls

- Background color picker
- Background image selection/clear
- `Shift + wheel` in player: zoom background
- `Shift + drag` in player: move background
- `Shift + R`: reset background position and scale
- Selecting a new background image resets its position/scale to defaults

## Spine info section

Settings include a **Spine info** block:

- Top-level sections from skeleton JSON
- name-only listing for `bones`, `slots`, `skins`, `animations`
- raw JSON view for `skeleton` and `transform`
- Show/Hide toggle for the entire info block

## Keyboard shortcuts

Shortcuts are ignored in text-entry contexts (`input` text types, `textarea`, `contenteditable`), and use `KeyboardEvent.code` bindings.


| Action                               | Keys                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| Show / hide settings panel           | **S**                                                        |
| Pause / play toggle                  | **P** or **Space**                                           |
| Previous / next animation            | **Arrow Left** / **Arrow Right**                             |
| Decrease / increase animation speed  | **Arrow Down** / **Arrow Up**                                |
| Decrease / increase spine scale      | **Minus** or **NumpadSubtract** / **Equal** or **NumpadAdd** |
| Reset spine position / scale / speed | **R**                                                        |
| Reset background position / scale    | **Shift + R**                                                |


## Mouse gestures in player


| Gesture       | Effect          |
| ------------- | --------------- |
| Drag          | Pan Spine       |
| Wheel         | Spine zoom      |
| Shift + wheel | Background zoom |
| Shift + drag  | Background move |


## Stack

- React + TypeScript + Vite
- pixi.js 8.x
- @esotericsoftware/spine-pixi-v8 (Spine 4.2 runtime for Pixi v8)
- Sass modules

## High-level structure

- `src/App.tsx` - app state, loading pipeline, shortcuts, panel/player wiring
- `src/components/SettingsPanel/` - file loading UI, playback controls, sliders, info section
- `src/components/SpinePlayer/SpinePlayer.tsx` - Pixi runtime, Spine instance, canvas interaction
- `src/utils/loadSpineFiles.ts` - file classification, atlas page parsing, object URL mapping
- `src/utils/spineViewScale.ts` - shared scale/speed min/max/step constants

