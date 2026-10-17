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
- Select or drop one non-empty `.mov`, `.mp4`, `.avi`, `.mkv`, or `.webm` file, select a demo verdict, then click Start Analysis. Extensions are case-insensitive. Selecting a file never starts processing.
- The three processing stages are timed demonstrations. Cancel returns to the selected file. Results navigation stays disabled until processing finishes.
- Videos use local object URLs, which are released when replaced or removed. No video or frame is transmitted to a service.
- Event buttons update the details and seek the local player. Sample timestamps adapt to short videos. Playback uses native browser controls.
- Evidence is a clearly labeled schematic placeholder. Click it to open a native modal dialog; close with the close button, the backdrop, or Escape.
- Both verdict scenarios retain the video and results columns. Mobile uses stacked content and bottom navigation.

## Assets and limitations

`public/data-sentry.png` is the supplied, unmodified 1254 × 1254 RGB logo. It has an opaque off-white background, not transparency. CSS grayscale/contrast and multiply/screen blending preserve the mark and avoid a rectangular background in either theme. A genuinely transparent logo export is still needed for final production assets.

Playback depends on the browser, container, and embedded codecs. AVI, MKV, and some MOV files may not play; any unsupported or damaged video shows a localized error with guidance to convert locally to H.264 MP4. There is no automatic conversion. The uploaded file is preserved unchanged. Validation checks the extension and non-zero size; it cannot establish that renamed or malformed content is a valid video. A future backend must validate the actual media stream.

### Backend and competition API

This checkout contains no backend, video processing pipeline, API client, or `/api/v1/analyze` implementation or contract definition. No files are submitted to an analysis endpoint. The existing labeled demo workflow is unchanged; accepting a format in the UI does not mean it is supported for real analysis.

FFmpeg and ffprobe are available on this development machine, but there is no server in which to integrate normalization. End-to-end processing for all five formats requires the competition backend and its request/response contract. When integrating it, preserve the judges' existing `.mov` request contract at `/api/v1/analyze` and perform any required normalization locally on the server after media validation. No endpoint, conversion service, or new mock results were added for multi-format support.

All events, evidence, and regulatory references are explicitly illustrative. Supply approved regulatory documents and real backend results in a later stage. There is no backend, model, authentication, database, or external API integration.

## Source map

- `src/App.tsx`: local file lifecycle, navigation, and demo processing state.
- `src/i18n.tsx`: typed Russian, Kazakh, and English dictionaries and language context.
- `src/videoFormats.ts`: shared supported extensions, input filter, validation, and format labels.
- `src/components/Layout.tsx`: header, theme and language controls, desktop/mobile navigation.
- `src/components/VideoUpload.tsx`: validation, drag and drop, file selection, and demo controls.
- `src/components/ProcessingStatus.tsx`: accessible three-stage indicator.
- `src/components/ResultsView.tsx`: verdict, video playback, event details, and evidence dialog.
- `src/styles.css`: Tailwind import, theme variables, and responsive component styles.
- `public/demo-frame.svg`: illustrative evidence placeholder, not extracted footage.

## Verification

The production build and TypeScript checks pass. DOM smoke checks covered all three languages, persisted theme selection, file validation, explicit start, cancellation, demo stages, both verdicts, navigation, event selection and seeking (including metadata arriving after a click), modal open/close, codec error messaging, and object URL cleanup. The local development server returned HTTP 200.

Multi-format checks used locally generated MOV, MP4, AVI, MKV, and WebM samples verified with ffprobe. DOM tests passed for selection and drag-and-drop of all five, uppercase extensions, rejection of empty/unsupported/multiple files, dynamic format labels, and simulated metadata, playback-error, and recovery events. Error translations were checked in Russian, Kazakh, and English. These tests do not establish browser codec support or backend processing support.

No connected browser was available for visual review, responsive viewport inspection, native dialog keyboard behavior, or actual video decoding. Those checks remain manual; DOM checks do not substitute for browser playback testing.
