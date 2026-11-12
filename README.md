# Saga

An all-in-one media tracker for Android: films, series, anime, games, books and a Doctor Who timeline, in one app that keeps everything on the phone.

Pre-alpha (versions stay under 1.0).

## What it does

- Track, rate and tick episodes without an account; everything lives on the phone.
- Import from IMDb (CSV and lists), Trakt (export zip and live sync), Steam, AniList, MyAnimeList, Letterboxd, Goodreads, Netflix history.
- Game prices from several stores (IsThereAnyDeal, CheapShark).
- Optional AI help (Gemini, Claude, OpenAI-compatible providers) with your own key.
- Six home-screen widgets, long-press shortcuts, themes.

## Layout

| Folder | What is in it |
| --- | --- |
| `web/` | The app itself: one WebView page (`index.html`, `app.js`, `core.js`, feature modules) and its tests |
| `java/` | The Android shell: activity, bridge to files and network, widgets |
| `legacy/` | The original games and Doctor Who pages, migrated on first start |
| `res_extra/`, `res_gen/` | Android resources |
| `scripts/` | Build helpers and `export_public.py` |
| `build.sh` | Builds the APK |

## Building

`build.sh` builds without the Android SDK: `javac` against stubs, then `d8`, `apktool`, `zipalign` and `apksigner` (put the jars in `tools/`). Set `KS` and `KSPW` to your own keystore and its password, plus `VERSION_CODE` and `VERSION_NAME`.

## Tests

```
cd web
node test_core.js          # and the other test_*.js files
```

Page tests need Playwright (`npm install playwright && npx playwright install chromium`). Tests that replay the author's own data skip themselves when those files are absent.

## Keys

No API keys are included. Add your own in the app's Settings (TMDB, Trakt, Steam, ITAD, an AI provider). Backup files leave keys out unless you turn that on.
