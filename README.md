# DATA Sentry

Stage 1 frontend prototype built with React, Vite, TypeScript, Tailwind CSS, and Lucide React.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

On Windows PowerShell with script execution disabled, use `npm.cmd install` and `npm.cmd run dev`.

```sh
npm run build
npm run preview
```

## Prototype behavior

- Russian is the default; Kazakh and English are available immediately through the header selector. Translation keys are checked by TypeScript in `src/i18n.tsx`.
- The theme follows the system until a manual preference is saved in localStorage.
- Select or drop one non-empty `.mov` file, select a demo verdict, then click Start Analysis. Selecting a file never starts processing.
- The three processing stages are timed demonstrations. Cancel returns to the selected file. Results navigation stays disabled until processing finishes.
- Videos use local object URLs, which are released when replaced or removed. No video or frame is transmitted to a service.
- Event buttons update the details and seek the local player. Sample timestamps adapt to short videos. Playback uses native browser controls.
- Evidence is a clearly labeled schematic placeholder. Click it to open a native modal dialog; close with the close button, the backdrop, or Escape.
- Both verdict scenarios retain the video and results columns. Mobile uses stacked content and bottom navigation.

## Assets and limitations

`public/data-sentry.png` is the supplied, unmodified 1254 × 1254 RGB logo. It has an opaque off-white background, not transparency. CSS grayscale/contrast and multiply/screen blending preserve the mark and avoid a rectangular background in either theme. A genuinely transparent logo export is still needed for final production assets.

MOV is a container; playback depends on the browser and embedded codecs. Unsupported encodings show a localized message. Prefer a browser-compatible H.264 MOV for review.

All events, evidence, and regulatory references are explicitly illustrative. Supply approved regulatory documents and real backend results in a later stage. There is no backend, model, authentication, database, or external API integration.

## Source map

- `src/App.tsx`: local file lifecycle, navigation, and demo processing state.
- `src/i18n.tsx`: typed Russian, Kazakh, and English dictionaries and language context.
- `src/components/Layout.tsx`: header, theme and language controls, desktop/mobile navigation.
- `src/components/VideoUpload.tsx`: validation, drag and drop, file selection, and demo controls.
- `src/components/ProcessingStatus.tsx`: accessible three-stage indicator.
- `src/components/ResultsView.tsx`: verdict, video playback, event details, and evidence dialog.
- `src/styles.css`: Tailwind import, theme variables, and responsive component styles.
- `public/demo-frame.svg`: illustrative evidence placeholder, not extracted footage.

## Verification

The production build and TypeScript checks pass. DOM smoke checks covered all three languages, persisted theme selection, file validation, explicit start, cancellation, demo stages, both verdicts, navigation, event selection and seeking (including metadata arriving after a click), modal open/close, codec error messaging, and object URL cleanup. The local development server returned HTTP 200.

No connected browser was available for visual review, responsive viewport inspection, native dialog keyboard behavior, or actual MOV decoding. Those checks remain manual; DOM checks do not substitute for browser playback testing.
