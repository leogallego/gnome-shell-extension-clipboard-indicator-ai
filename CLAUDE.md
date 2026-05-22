# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clipboard Indicator is a GNOME Shell extension (UUID: `clipboard-indicator@tudmotu.com`) that provides clipboard history management. It targets GNOME 46-50 and uses GJS (GNOME JavaScript) with GObject Introspection bindings (`gi://` imports). There is no npm, no bundler, no transpilation — files are loaded directly by GNOME Shell.

## Build & Development Commands

```bash
# Compile GSettings schemas and locale .mo files (required after schema or translation changes)
make

# Install to ~/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/
make install

# Build distributable zip for extensions.gnome.org
make bundle

# Update .pot and merge into existing .po translation files
make update-po-files

# Launch a nested GNOME Shell session for testing (Wayland, 2048x1536@2x)
make nested-session
```

After `make install`, restart GNOME Shell (log out/in on Wayland, or Alt+F2 `r` on X11) and enable with:
```bash
gnome-extensions enable clipboard-indicator@tudmotu.com
```

There is no test suite or linter configured.

## Architecture

The extension is a flat set of ES modules — no subdirectories for source code.

### Module Responsibilities

- **`extension.js`** (~1970 lines) — The main module. Exports `ClipboardIndicatorExtension` (lifecycle: `enable`/`disable`) which creates a `ClipboardIndicator` GObject class extending `PanelMenu.Button`. Contains all UI construction (panel button, popup menu, search bar, history sections, favorites section, action buttons), clipboard monitoring via `Meta.Selection`, keyboard shortcut binding, settings synchronization, private mode, app exclusion, image preview overlay, tag/edit dialogs, interval-based history clearing, and paste simulation via virtual keyboard.

- **`registry.js`** — Persistence layer. `Registry` reads/writes clipboard history to `~/.cache/clipboard-indicator@tudmotu.com/registry.txt` as JSON. Handles image file caching (stored as hashed filenames in the same cache dir). `ClipboardEntry` models a single clipboard item with mimetype, bytes, favorite flag, and optional tag. Supports text and image entries.

- **`prefs.js`** (~710 lines) — Preferences window using libadwaita (`Adw.PreferencesWindow`). Organized into tabbed pages (UI, Behavior, Search, Limits, Exclusion, Topbar, Notifications, Shortcuts). Loaded by GNOME in a separate process from the extension.

- **`constants.js`** — Maps `PrefsFields` enum to GSettings key names. Single source of truth for settings key strings used by both `extension.js` and `prefs.js`.

- **`confirmDialog.js`** — `DialogManager` wraps a `ModalDialog` for confirmation prompts (clear history, delete pinned items). Ensures only one dialog at a time.

- **`keyboard.js`** — `Keyboard` class wraps a Clutter virtual keyboard device for simulating paste keystrokes (Shift+Insert for normal apps, Ctrl+Shift+Insert for terminals).

- **`stylesheet.css`** — All CSS classes prefixed with `ci-` or `clipboard-indicator-`/`clipboard-menu-`.

### Settings

All preferences are defined in `schemas/org.gnome.shell.extensions.clipboard-indicator.gschema.xml`. After modifying this file, run `make compile-settings` (or just `make`). The compiled binary `schemas/gschemas.compiled` is checked into the repo.

### Translations

25 locales under `locale/*/LC_MESSAGES/`. The `.pot` template is `clipboard-indicator.pot`. After adding new translatable strings (wrapped in `_()` or `N_()`), run `make update-po-files`.

## Key Patterns

- **GObject registration**: The `ClipboardIndicator` class uses `GObject.registerClass` with a `GTypeName`. It follows GNOME Shell's `_init` convention (not a standard constructor).
- **Settings flow**: Module-level `let` variables (e.g., `MAX_REGISTRY_LENGTH`, `PRIVATEMODE`) are synced from GSettings in `_loadSettings()` and updated via `settings.connect('changed')`. These are effectively global state within the extension.
- **Clipboard monitoring**: Uses `global.display.get_selection().connect('owner-changed')` to detect clipboard changes, then reads content via `St.Clipboard`.
- **Private fields**: Uses JS private class fields (`#field`) extensively in `ClipboardIndicator`, `Registry`, `ClipboardEntry`, `DialogManager`, and `Keyboard`.
- **Async I/O**: Registry file operations use GIO async methods (`replace_async`, `load_contents_async`) wrapped in Promises.

## Contributing Guidelines (from upstream)

- Do not open unsolicited PRs — look for "Up for grabs" issues first.
- Discuss features in issues before implementing.
- Release cycle follows GNOME's (~2 updates/year around GNOME major releases).
- Translation PRs are always welcome without prior discussion.
