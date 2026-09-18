# Dynamic Panel Architecture Audit

## Scope

This audit covers the Electron main process, preload bridge, renderer boot sequence, renderer domain modules, and CSS ownership. The review preserves existing IPC channels, LocalStorage keys, portable workspace data, and platform behavior as compatibility boundaries.

## Findings

### 1. Main-process composition root is also a domain implementation

`main.js` is 4,700+ lines and currently contains all of the following responsibilities:

- window creation, geometry, collapse/blur lifecycle, multi-display relocation, and hover polling;
- tray/menu construction and global shortcut registration;
- task notification HTTP server and notification window queue;
- workspace settings and workspace folder migration;
- finance provider settings and background refresh scheduling;
- public URL validation, link redirects, favicon fetching, and AI link organization;
- current-window enumeration, icon extraction, focus, and paste-target handling;
- credentials vault persistence;
- transcription provider configuration, WebSocket sessions, diagnostics, and recordings;
- note-image and clipboard-image filesystem ownership;
- IPC registration for every feature.

The main issue is not merely file length. These domains share mutable closure state and Electron globals, so unrelated changes can affect lifecycle, permissions, or cleanup behavior. IPC registration is also mixed with implementation, making contracts difficult to audit.

### 2. Renderer boot and feature behavior are only partly separated

`renderer/app.js` is 5,000+ lines. It owns the application shell, mode transitions, tabs, todos, notes, home scratch data, clipboard history, theme application, shortcut recording, and several shared event handlers. Existing files such as `home.js`, `finance.js`, `capture.js`, and `settings.js` are useful boundaries, but the core file still owns too many feature states.

`renderer/workspace.js` is a second settings/workspace controller that also owns recordings, credentials, notes, links, shortcuts, theme persistence, and settings rendering. The split is historical rather than domain-driven: page markup, persistence, IPC, and interaction handlers are distributed between `app.js`, `workspace.js`, and feature files.

### 3. IPC bridge is broad but not grouped by ownership

`preload.js` exposes a flat object containing window, workspace, AI, finance, media, capture, clipboard, notes, credentials, launcher, and shortcut operations. This is secure because the bridge is explicit, but the flat namespace makes feature ownership unclear and encourages adding more methods to the same object.

The next safe step is not to change channel names. It is to group bridge methods by domain internally while preserving the existing public names during migration.

### 4. CSS has the same ownership problem

`renderer/styles.css` is 6,000+ lines and includes shell, todos, notes, clipboard, music, pomodoro, credentials, settings, launcher, and historical compatibility rules. Feature styles already exist for home, links, finance, AI, capture, launcher, and settings, but the largest shared file still contains feature-specific rules.

Theme overrides at the end of the file currently compensate for hard-coded dark-surface colors. This makes visual ownership and contrast auditing harder.

## Refactoring boundaries

The following boundaries are recommended and preserve current contracts:

1. `main/window-geometry.js` - display selection, mode bounds, collapsed height, and Windows shape application. **Completed in this pass.**
2. `main/link-inspector.js` - public URL validation, bounded redirects, favicon retrieval, response limits, and optional AI link organization. No Electron dependency; receives network and AI callbacks.
3. `main/task-notifications.js` - notification normalization, queue state, HTTP server, notification window lifecycle, and dismissal timers. Receives window/display callbacks.
4. `main/clipboard-service.js` - polling, baselines, image ownership, read/write/paste, and cleanup. Receives Electron clipboard and filesystem paths.
5. `main/transcription-service.js` - provider config, encrypted key resolution, WebSocket sessions, diagnostics, and recording lifecycle. Receives safeStorage, WebSocket, and persistence callbacks.
6. `main/workspace-files.js` - workspace path selection, portable snapshots, note images, recording paths, and clipboard image paths.
7. `renderer/shell.js` - mode transitions, accessibility, tab selection, theme application, layout metrics, and shared toasts.
8. `renderer/todos.js`, `renderer/notes.js`, and `renderer/clipboard.js` - move feature state and event delegation out of `app.js` while exposing small render/update APIs to the shell.
9. `renderer/settings/` modules - split settings rendering and persistence by shortcuts, appearance, workspace, AI, media, and home modules.
10. CSS ownership - move feature-specific rules from `styles.css` into existing feature stylesheets; retain only tokens, shell, common controls, and compatibility rules in `styles.css`.

## Migration rules

- Keep IPC channel strings unchanged until all renderer callers migrate.
- Keep LocalStorage keys and portable workspace schema unchanged.
- Use factories with explicit dependencies for main-process services; do not import Electron from pure domain modules.
- Keep cleanup functions idempotent and register them from one composition root.
- Add focused tests for extracted pure policies before moving lifecycle code.
- Make one domain extraction per commit so regressions are attributable.

## Suggested order

1. Window geometry (completed).
2. Link inspector, because it is already a bounded security-sensitive domain and has pure tests around URL safety.
3. Workspace filesystem ownership, because recordings, note images, and clipboard images currently duplicate path validation patterns.
4. Task notifications and clipboard polling, because both contain timers and lifecycle cleanup that benefit from isolated tests.
5. Renderer shell and feature state extraction.
6. CSS ownership cleanup after DOM/controller boundaries stabilize.

## Acceptance criteria

- No IPC channel or persisted key changes as a side effect of structural refactoring.
- `node --test` focused suites pass after each extraction.
- Main process can be syntax-checked without Electron startup.
- Extracted services can be unit-tested with injected fakes.
- Renderer feature files expose explicit initialization/render functions rather than relying on undocumented globals.
- The composition root remains responsible only for dependency construction, lifecycle wiring, and IPC registration.
