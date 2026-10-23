# Voltra icons

The production master is `voltra.svg`, redrawn from the supplied existing icon.
It retains the dark geometric V, rounded silver-white tile and subtle facets.
The SVG has no font, external image or network dependency. Generated raster
drafts were not shipped because their transparent edges were unsuitable for
small icons. `voltra-master.png` is the 1024px export of the final vector.

## Locations

- `web/public/brand/voltra.svg`: scalable mark.
- `web/public/brand/voltra-{size}.png`: 16, 24, 32, 48, 64, 128, 180, 192, 256,
  512 and 1024 pixels, with transparent outer corners.
- `web/public/favicon.ico` and `favicon.svg`: browser tabs and bookmarks.
- `web/public/apple-touch-icon.png`: opaque 180px iOS home-screen icon.
- `web/public/brand/voltra-maskable-{192,512}.png`: opaque, padded Android icons.
- `web/public/manifest.json`: home-screen name, colors and icon declarations.
- `desktop/assets/app.ico`: seven resolutions for Windows Explorer/taskbar.
- `desktop/assets/app.png`: native application/about icon.
- `desktop/assets/app.icns`: macOS artwork export for future packaging.

The shared `BrandMark` component supplies the server/admin sidebar, setup/login,
and desktop connection screens. Custom panel names remain supported. The Windows
build script generates a native icon resource before compiling the executable.
The ICNS file and PNG family are available for future platforms; they do not
imply tested macOS/Linux app packaging or offline web functionality.

## Regenerate

From the repository root:

```powershell
npm.cmd ci --prefix tools/branding
npm.cmd run export --prefix tools/branding
npm.cmd run build --prefix web
.\desktop\build.ps1
```

The renderer is pinned in tools/branding/package-lock.json. Exporting assets
does not require image generation, an API key or a remote service. The desktop
resource generator is a separate pinned Go module, matching Wails' resource ID.
Do not clean the live web/dist directory while updating assets.
