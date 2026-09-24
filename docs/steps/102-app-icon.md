# Step 102 — application icon

Date: 2026-09-24. Repository implementation prepared for review; no production or store release performed.

## Product contract

Sudoku uses the operator-selected line-art Sudoku mark as the application icon. The artwork stays centered and unchanged in shape. Packaging adds the existing warm surface color (`#fffdf8`) as an opaque background and uses the existing dark ink color (`#182126`) for the mark. iOS applies its own system icon mask; the source asset does not draw rounded corners.

The same mark is used by the native iPhone application, the web metadata, the PWA manifest and the Apple touch icon. Raster assets are generated from the single checked-in SVG master so the web and native forms cannot drift.

## Source and license

The source is [Sudoku icon 504927 on SVG Repo](https://www.svgrepo.com/svg/504927/sudoku), supplied by the operator as `sudoku-svgrepo-com.svg`. SVG Repo identifies the asset as CC0. The repository SVG comment records the source and the packaging-only changes.

## Assets and validation

The native asset catalog contains the iPhone notification, settings, Spotlight, home-screen and 1024-pixel App Store sizes. Each PNG is RGB and opaque. The web package contains 192-pixel, 512-pixel and 180-pixel Apple touch variants.

Local validation passed for every generated pixel dimension and absence of alpha, asset-catalog JSON parsing, zero-warning web lint, web type checking and an unsigned generic-iPhone build. Xcode compiled the AppIcon catalog without asset warnings after the target was explicitly constrained to iPhone. Visual review of the 1024-pixel master and 60-pixel rendition confirmed centering, safe margins, no clipping and readable line work. Exact-head CI remains required before merge.
