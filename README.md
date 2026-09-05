# Titan's Glyph Grimoire

A browser-based spell-casting simulator inspired by _The Owl House_. Draw the
four primal glyphs on a canvas and watch them compile into magic. No account,
no backend, and no data leaves your device.

> **Fan project disclaimer:** This is an unofficial fan-made website. It is not
> affiliated with, endorsed by, sponsored by, or otherwise related to Disney or
> any of its subsidiaries. _The Owl House_ and all related characters, glyphs,
> art, and lore are the property of their respective owners. This project uses
> those elements solely as homage for non-commercial, educational purposes.

## Features

- **Hybrid gesture recognition:** a rotation-invariant point-cloud matcher that
  fuses chamfer distance with a soft-IoU occupancy-grid descriptor, plus
  single-stroke scribble defense (`src/recognizer.ts`).
- **Two casting modes:** Trace mode overlays a glyph guide and scores stroke
  accuracy; Sandbox mode lets you free-draw any element and compile it.
- **Spellbook:** 4 primal glyphs (Light, Ice, Plant, Fire) and combinatory
  arrays (Sleep Mist, Wind Vortex, Invisibility Shroud, Safety Hover,
  Petrification, Abomination Mutation).
- **Procedural FX:** a 60 FPS canvas particle simulation drives each spell's
  effects, entities, and element-on-element reactions.
- **Runtime audio:** all sound is synthesized with the Web Audio API in
  `src/utils/synth.ts`; no audio assets are shipped.
- **Keyboard shortcuts:** `M` mute, `T` trace mode, `S` sandbox mode, and `/`
  to focus search.
- **Offline-capable static build:** plain Vite output, no backend required.

## Tech Stack

| Layer      | Choice                        |
| ---------- | ----------------------------- |
| UI         | React 19                      |
| Build tool | Vite 6                        |
| Styling    | Tailwind CSS 4                |
| Language   | TypeScript 5.8                |
| Audio      | Web Audio API (runtime synth) |

## Getting Started

Prerequisites: Node.js 18+ and npm.

```sh
npm install     # install dependencies
npm run dev     # start the dev server at http://localhost:3000
npm run build   # create a production build in dist/
npm run preview # serve the production build locally
```

No environment variables are required to run, build, or deploy the app, so the
repository ships no `.env.example`.

## Accessibility

This project targets WCAG 2.1 AA.

- **Semantic structure:** landmarks, headings, and native buttons throughout.
- **Keyboard operable:** all controls are reachable and operable by keyboard,
  with visible focus rings and a skip-to-canvas link.
- **ARIA:** live regions announce cast results (`aria-live`), toggle buttons
  expose pressed state (`aria-pressed`), and icon-only controls carry labels.
- **Motion:** ambient/looping CSS animations are disabled under
  `prefers-reduced-motion`; canvas FX are user-initiated feedback.
- **Canvas interaction:** the drawing surface is a single tab stop with a
  pointer-only interaction model; gesture results are announced via a live
  region.

## Project Structure

```
src/
├── App.tsx               # Layout, modes, keyboard shortcuts, localStorage persistence
├── spellsData.ts         # SPELLS_DATABASE: primitives and combinatory arrays
├── recognizer.ts         # Hybrid gesture matcher (chamfer + occupancy grid)
├── types.ts              # Shared TypeScript types
├── index.css             # Tailwind entry + reduced-motion handling
├── components/
│   └── MagicCanvas.tsx   # Canvas simulation loop, particles, recognition wiring
└── utils/
    └── synth.ts          # Web Audio sound synthesis
```

## Deployment

The production build in `dist/` is fully static, so any static host works:

- **Netlify / Vercel:** set the publish directory to `dist` and the build
  command to `npm run build`.
- **GitHub Pages / any web server:** upload the contents of `dist/`.

`public/robots.txt`, `public/sitemap.xml`, `public/site.webmanifest`, and the
favicon are copied into `dist/` automatically. The sitemap ships with a
placeholder domain (`glyph-magic-simulator.example.com`); replace it with your
production origin before deploying.

## Troubleshooting

- **Nothing draws:** the canvas responds to pointer (mouse/touch/pen) input
  only; it is not keyboard-drawable. Click and drag inside the framed pad.
- **A glyph won't compile:** slow, deliberate strokes score higher than quick
  scribbles. In Trace mode, follow the violet guide closely; in Sandbox mode,
  finish a recognizable glyph before pressing **Activate Glyph**.
- **No sound:** press `M` or the **Audio Aura** button to unmute. Browsers
  require a user gesture before audio can start.

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-change`.
3. Make your changes and verify the type gate: `npm run lint` (`tsc --noEmit`).
4. Commit and open a pull request.

## Disclaimer

This project is an unofficial, non-commercial fan work created for fun and
education. It is not affiliated with, endorsed by, or sponsored by Disney, and
no Disney entity has any relationship to this project. _The Owl House_ and all
related characters, glyphs, designs, and lore are trademarks/copyright of their
respective owners; the series was created by Dana Terrace and produced by
Disney Television Animation. Glyph designs and lore are referenced here solely
as homage.

## License

[MIT](LICENSE). See also the [privacy notice](PRIVACY.md); the app collects no
data.
