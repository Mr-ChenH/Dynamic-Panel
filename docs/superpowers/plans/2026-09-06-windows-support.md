# Windows Support Implementation Plan

**Goal:** Ship a tested Windows x64 installer alongside the existing macOS DMG and expose both on the website.
**Architecture:** Shared renderer and domain data, pure platform policy for native differences, capability-aware layout, dual build jobs feeding one release job.
**Tech Stack:** Electron 44, Node 22, electron-builder NSIS, React/Vinext, GitHub Actions.
**Spec:** `docs/plans/2026-09-06-windows-design.md`

## Constraints

- Preserve storage keys and Mac behavior; keep unrelated user documents untouched.
- Windows hides music/windows without persisting forced hiding; clipboard copy only.
- Build Windows 10/11 x64 and macOS 13+ arm64; same version, distinct installer names.
- Native Windows CI verification required before publication; disclose hardware testing limits.

## Execution

- [ ] Platform policy: add `platform.js`, consume in `main.js` and preload, test geometry (negative origins/top/side/bottom taskbars), capability fallback and final-visible-module behavior in `tests/platform.test.js` using literal fixtures. Run failing tests, implement, rerun.
- [ ] Renderer: union unavailable modules only when resolving layout; preserve saved visibility; prevent hiding final available module; neutralize Mac copy; hide unavailable switches; verify actual DOM with Electron.
- [ ] Packaging/testing: cross-platform Node test runner; NSIS current-user installer; actual application CDP smoke in isolated profile, packaged and installed checks, fake camera/audio, user-data retention and uninstall. Keep startup tests finite and capture logs/screenshots.
- [ ] Website: Windows asset selector and a second glass-pill button; assert mixed-release selection and SSR buttons; run website tests/lint/build and browser layout verification at desktop/mobile sizes.
- [ ] Release: bump shared version to 1.1.0, update CHANGELOG/README/releasing guide, build both targets and publish only after both pass; push branch for CI first, repair failures before main/tag; verify four Release assets and live Pages button targets.

Run `npm test` for desktop, `npm test && npm run lint && npm run build` in website, and Windows CI for platform/installed behavior. Commit only scoped paths. Final handoff includes Release/website links and actual verification evidence.
