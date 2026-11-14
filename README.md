# Blade Archive (static)

A tiny static website that shows a personal archive stored in **Google Drive**.
You drop files into a Drive folder and the site shows them. Visitors can
**view, download, or use** (play) the files. No server, no database — just
static files on Cloudflare Pages, plus an optional browser **admin panel** for
uploads and metadata editing.

## How it works

```
Google Drive
  ├── Content folder  (your files: images, videos, audio, etc.)
  └── Meta folder     (per-item <name>.json + <name>.jpg thumbnail + site.json)
        │
        ▼
Site reads both folders with the Google Drive API  ──►  gallery
```

- The site lists the **content folder** and the **meta folder**.
- For each content file `name.ext`, it looks for `name.json` and `name.jpg`
  (same base name) in the meta folder.
- Everything updates automatically when you change the folders — no re-upload.

## One-time setup

1. Create two folders in Google Drive, e.g. `odd-content` and `odd-meta`.
2. Share **both** folders: **Anyone with the link** (Viewer).
3. In Google Cloud Console:
   - Enable the **Google Drive API**.
   - Create an **API key** and restrict it to your site's domain under
     "HTTP referrers" (e.g. `https://your-site.pages.dev/*`).
4. Copy the folder IDs from the URLs:
   `https://drive.google.com/drive/folders/<FOLDER_ID>`
5. Put them in `assets/config.js`:
   ```js
   window.ODDS_CONFIG = {
     driveApiKey: 'YOUR_API_KEY',
     contentFolderId: 'CONTENT_FOLDER_ID',
     metaFolderId: 'META_FOLDER_ID',
     manifestFileId: '',
     driveProxyUrl: '',                       // see "Drive playback proxy" below
     aboutUrl: 'https://bladelow.github.io',  // top nav + footer "About" link
   };
   ```
6. Deploy the site (see below) once.

## Add content

1. Put the file in the **content folder**.
2. Put a JSON in the **meta folder** with the **same base name**:
   `content/my-video.mp4` → `meta/my-video.json`.
3. (Optional) Put a thumbnail `meta/my-video.jpg` (otherwise Drive's own
   thumbnail is used).

Per-item JSON format:

```json
{
  "title": "My video",
  "description": "Short description",
  "type": "video",
  "tags": ["games"],
  "date": "2026-01-01"
}
```

- `type` is optional — if omitted it is detected from the file's MIME type
  (`image`, `video`, `audio`, `html`, or `file`).
- `type: "html"` plays a self-contained `.html` file (a game or demo) in a
  sandboxed iframe on the item page.
- `date` in the last 14 days gets a blinking "NEW" flag.

Optional `meta/site.json` for the site header/footer:

```json
{
  "title": "Blade Archive",
  "tagline": "A personal archive of things I make",
  "announcement": "New uploads are added whenever I remember.",
  "intro": "Welcome to my little corner of the internet.",
  "footer": "© Blade Archive"
}
```

## Item pages

Every card opens its **own page**: `item.html?id=<file id>` (like a CurseForge
project page).

- Shows the media (image, video, or audio) in the **built-in custom player**
  (see below), the title, description, date, tags, a **Download original**
  button, and a **More &lt;type&gt;** strip of related items.
- It reads the same folders / `content.json`, so there is no extra config.
- New items get their page automatically — no extra files to create.

## Media player

A custom, theme-matched player (no Google Drive iframe) powers images, video,
and audio on the item page. It works in every modern browser and avoids the
Drive embed that some browsers block.

- **Video/audio:** play/pause, seek bar, volume + mute, playback speed
  (0.5×–2×), picture-in-picture (video), fullscreen, and download.
- **Image:** zoom in/out/reset, drag-to-pan, open original, download.
- **Other files** (zip, etc.): a download card.
- **HTML games/demos:** a self-contained `.html` file (type `html`) renders in
  a sandboxed iframe with **Reload**, **Open in new tab**, and **Download**.
- **Keyboard:** `Space`/`K` play-pause, `←`/`→` seek, `↑`/`↓` volume, `M` mute,
  `F` fullscreen, `+`/`-`/`0` zoom (images).
- Drive media bytes are fetched through the Drive API (or the optional proxy
  below) into a Blob, then played natively — so no third-party iframe and no
  `ORB` blocking. The player shows a progress bar while it downloads; very
  large files take longer to start.

## Drive playback proxy (if video/audio/HTML won't load)

Browsers block cross-site `fetch()` to `drive.usercontent.google.com`, and the
Drive API `alt=media` endpoint is rate-limited on some networks (403 "automated
queries"). If the player shows **"Failed to fetch"** / **"Media download
failed"**, set up the free proxy:

1. Cloudflare Dashboard → **Workers & Pages** → **Create → Worker**.
2. Paste `cloudflare-worker/worker.js` and **Deploy**.
3. Copy the worker URL, e.g. `https://blade-proxy.<subdomain>.workers.dev/`.
4. In `assets/config.js`:
   ```js
   driveProxyUrl: 'https://blade-proxy.<subdomain>.workers.dev/',
   ```
5. Redeploy the site.

The site then fetches `<driveProxyUrl>?id=<fileId>`; the worker downloads the
file from Drive server-side and returns it with CORS headers. This works for
video, audio, and HTML games, and it is not affected by the browser CORS or the
Drive anti-abuse block.

## Fallbacks (no folder setup)

If `contentFolderId`/`metaFolderId` are empty:

- If `manifestFileId` is set, the site loads that single `content.json` from
  Drive (via the Drive API, or a direct download link).
- Otherwise it loads the bundled `content.json` next to `index.html`.

The bundled `content.json` shape:

```json
{
  "site": { "title": "Blade Archive", "tagline": "...", "intro": "...", "footer": "..." },
  "items": [
    { "id": "my-item", "title": "My item", "description": "...", "type": "image",
      "fileId": "FILE_ID_FROM_DRIVE", "thumbId": "", "tags": ["games"], "date": "2026-01-01" }
  ]
}
```

## Dark mode

- Follows your **system** setting by default (`prefers-color-scheme`).
- Header **🌙 Dark / ☀️ Light** button toggles it.
- Choice is saved in `localStorage`.

## Run locally

```bash
npm start
# open http://localhost:4000
```

(No `npm install` needed — it uses only Node built-ins.)

## Admin panel (upload + edit from the browser)

`admin.html` lets you sign in with Discord and upload/edit content directly in
Google Drive — no need to open Drive in another tab. It is **static** (no
server): Discord is the sign-in gate, and a Google OAuth token authorises the
Drive folders (which only your Google account can write to).

### Setup

1. **Discord app** — <https://discord.com/developers/applications> → *New
   Application*. Copy the **Client ID** into `discordClientId` in
   `assets/config.js`. Under **OAuth2 → Redirects**, add:
   `http://localhost:4000/admin.html` (local) and
   `https://<your-site>/admin.html` (production).
2. **Google OAuth client** — <https://console.cloud.google.com/apis/credentials>
   → *Create credentials → OAuth client ID → Web application*. Add
   `http://localhost:4000` and your site origin as **Authorized JavaScript
   origins**, then copy the **Client ID** into `googleClientId`.
   The panel requests the `https://www.googleapis.com/auth/drive` scope; while
   the app is in *Testing*, add your Google account as a **test user**.
3. **Admin ID** — in Discord: *Settings → Advanced → Developer Mode*, then
   right-click your name → *Copy User ID*. Put it in `adminDiscordIds`:
   ```js
   adminDiscordIds: ['123456789012345678'],
   ```
4. Reload `admin.html`. Sign in with Discord, then click **Connect Google Drive**.

### Using it

- **Upload content**: choose a file, set the **Title** (the file name is never
  used as the title once you set one), description, type, tags, date, and an
  optional thumbnail image. Uploads go straight to Drive (resumable, any size).
- **Edit**: click **Edit** on any row to change metadata, replace the thumbnail,
  or delete the item (removes the file, its JSON, and its thumbnail).
- Changes appear on the public site on the next page load.

> The Discord ID list is a convenience gate, not a security boundary: anyone can
> edit the client JS. The real boundary is the Google OAuth token — only the
> signed-in Google account can write to your Drive folders. Keep the panel link
> private (it is `noindex`).

## Deploy (free, permanent, no card)

### Cloudflare Pages (simplest)
1. Cloudflare dashboard → **Pages** → **Upload assets**.
2. Drag this whole folder (with `index.html`, `item.html`, `admin.html`,
   `assets/`, `content.json`).
3. Deploy. You get a free `https://<name>.pages.dev` URL.

### GitHub Pages (no Google Cloud, no API key)
1. Create a GitHub repo and upload these files (`index.html`, `item.html`,
   `admin.html`, `assets/`, `content.json`, `.nojekyll`).
2. Settings → **Pages** → Source: **Deploy from a branch** → `main` → `/ (root)`
   → Save.
3. Site: `https://<username>.github.io/<repo>/`.
4. Update: edit `content.json` on GitHub (pencil icon) → commit → site updates
   in ~1 min.

Media with GitHub Pages:
- **Repo-hosted:** put files in `media/` and use `"src": "media/my-video.mp4"`
  (optionally `"thumb": "media/my-video.jpg"`) in the item.
- **Drive-hosted:** use `"fileId": "..."` (public Drive link) — no API key needed.

The Drive folder auto-discovery (`contentFolderId` / `metaFolderId`) needs the
Google Cloud API key. If you don't want that, use GitHub Pages + `content.json`.

## Notes

- Every Drive file/folder must be shared **Anyone with the link**, or it won't load.
- Google Drive free storage is 15 GB (shared with your Google account).
- Videos and audio play through the built-in custom player (bytes fetched via
  the Drive API or the optional proxy), not the Drive iframe — this works in
  browsers that block third-party embeds. Large files take a moment to download
  before playing. If playback is blocked on your network, see the proxy above.
- Visitors get a **read-only** site: no uploads, no login. You control content
  from the Drive folders or the `admin.html` panel.
- The Drive API free tier is generous for a personal site (12,000 requests/min).