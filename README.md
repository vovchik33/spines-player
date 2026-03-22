# spines-player

Web viewer for [Spine](http://esotericsoftware.com/) skeletal animations: load exported skeleton + atlas + texture, pick clips, control playback, scale, and speed. Built with **React**, **Pixi.js v8**, and **@esotericsoftware/spine-pixi-v8**.

## Requirements

- Node.js (for local dev)

## Scripts

| Command        | Description                          |
| -------------- | ------------------------------------ |
| `npm run dev`  | Vite dev server with HMR             |
| `npm run build`| TypeScript check + production bundle   |
| `npm run preview` | Serve the `dist` build after build |
| `npm run lint` | ESLint                               |

## Layout

- **Left:** configuration panel (scrolls when content is tall; scrollbar is hidden but wheel / trackpad still scrolls).
- **Right:** Pixi canvas showing the Spine character. **Drag** with the pointer to **pan** the skeleton inside the view.

## Loading a Spine

1. Click **Choose…** and select **exactly three** files in one go:
   - **Skeleton:** `.json` or `.skel`
   - **Atlas:** `.atlas`
   - **Texture:** `.png`, `.jpg`, `.jpeg`, or `.webp` (must match the atlas page name)

2. The panel shows the current asset name (bundled sample **Cat** until you load your own).

3. If the selection is invalid, an error message explains what is wrong.

Loading a new pack **resets** spine **scale**, **animation speed**, and starts playback in **loop** at **1×** speed. It does **not** run the full **Reset** (see below).

## Default sample

If you do not load custom files, the app uses the bundled **Cat** skeleton from `public/spine/` (paths respect Vite `base`).

## Animation list & playback

- **Animation** dropdown lists all clips from the skeleton. After you pick one, the dropdown **blurs** so global shortcuts work without an extra click.
- **Play** — starts or **restarts** the current clip (from pause or from stop, or replay while already playing). **Resume** from pause does **not** restart the timeline.
- **Pause** — freezes the clip (`timeScale` 0); press again to **resume** from the same frame (**toggle**, same idea as **P**).
- **Stop** — clears the track and returns the skeleton to the **setup pose**.
- **Loop animation** — when checked, the active track loops; when unchecked, it plays **once** (then stops at the end unless you change mode).

**Pause** is disabled while **stopped**.

## Spine scale

- **Slider:** **0.1×** … **3×**, step **0.05**.
- **Reset** (next to the slider) also resets **animation speed** to **1×**, **clears pan**, and triggers a layout remeasure for the renderer.

## Animation speed

Controls Spine `AnimationState.timeScale` while **playing** (paused stays frozen; stopped ignores speed until you play again).

- **Slider:** **0.1×** … **3×**, step **0.05**.
- **Reset** (next to the speed slider) sets speed to **1×** only (does not change scale or pan).

## Keyboard shortcuts

Shortcuts are ignored while focus is in a **button**, **link**, **text field**, **range slider**, **`select`**, **`textarea`**, or **`contenteditable`**. They use physical **`KeyboardEvent.code`** where noted so layout (e.g. QWERTY vs other) does not change bindings.

| Action | Keys |
| ------ | ---- |
| Pause / play toggle | **P** (no repeat; **Ctrl / Cmd / Alt** not used) |
| Previous / next animation (dropdown order, wraps) | **Arrow Up** / **Arrow Down** |
| Decrease / increase animation speed | **Arrow Left** / **Arrow Right** |
| Decrease / increase spine scale | **Minus** or **NumpadSubtract** / **Equal** or **NumpadAdd** (`=` and `+` share the **Equal** key) |

**Range sliders:** after pointer **up** or **cancel**, the control **blurs**. **Escape** blurs a focused slider for keyboard users.

## Mouse wheel on the canvas

| Gesture | Effect |
| ------- | ------ |
| Wheel (no modifiers) | **Zoom** spine display (same idea as the scale slider; clamped **0.1×–3×**). |
| **Shift** + wheel | **Animation speed** up/down (same step family as the slider, clamped **0.1×–3×**). Uses the larger of **\|deltaX\|** vs **\|deltaY\|** so **Shift** + vertical scroll still works when the browser maps it to horizontal delta. |

Wheel handler uses **non-passive** `preventDefault` where it handles the event so the page does not scroll instead.

## Stack

- **React** + **TypeScript** + **Vite**
- **pixi.js** 8.x, **@esotericsoftware/spine-pixi-v8** (Spine 4.2 runtime for Pixi v8)
- **Sass** for component styles

## Project structure (high level)

- `src/App.tsx` — app state, shortcuts, load pipeline, passes props to panel + player.
- `src/components/SettingsPanel/` — file load UI, animation select, playback, sliders.
- `src/components/SpinePlayer/SpinePlayer.tsx` — Pixi app, Spine instance, pan, wheel zoom / speed, sync with React props.
- `src/utils/loadSpineFiles.ts` — classify three picked files, object URLs for blobs.
- `src/utils/spineViewScale.ts` — shared min/max/step for scale and animation speed (sliders, wheel, keyboard).
