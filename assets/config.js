/*
 * Google Drive folder discovery.
 *
 * Put the files you want to show in a PUBLIC "content" folder.
 * Put one "<name>.json" + "<name>.jpg" (thumbnail) per item, plus an optional
 * "site.json", in a PUBLIC "meta" folder. Same base name = matched.
 *
 * The site lists both folders with the Google Drive API and builds the gallery
 * automatically. No content.json editing needed.
 *
 * Setup:
 *   1. Share both folders "Anyone with the link".
 *   2. Enable the Google Drive API and create an API key (restrict it to your
 *      site's domain under HTTP referrers, e.g. https://your-site.pages.dev/*).
 *   3. Copy the folder IDs from their URLs:
 *      https://drive.google.com/drive/folders/<FOLDER_ID>
 *   4. Fill in the values below and re-deploy once.
 *
 * Fallbacks: if the folder fields are empty, the site uses a single
 * manifestFileId (content.json) or the bundled content.json.
 */
window.ODDS_CONFIG = {
  driveApiKey: 'AIzaSyDmjq6zEYakYzAcyf4IDvOcDnHk_Ea9P8I',
  contentFolderId: '1dPW4O8f_FTj1PCqnASxry2rlFY9RR0ql',
  metaFolderId: '18CLxhSfufQxK5sI7gw8f71osYCaLFS94',
  manifestFileId: '',

  // Optional: a CORS proxy for Drive downloads (recommended if playback is
  // blocked). Point this at a Cloudflare Worker that fetches
  // https://drive.usercontent.google.com/download?id=<id>&export=download and
  // returns the bytes with Access-Control-Allow-Origin: * and the real MIME.
  // Leave empty to use the Drive API alt=media endpoint directly.
  driveProxyUrl: '',

  // --- Site ---------------------------------------------------------------
  // Your intro / "about me" page. Shown as an "About" link in the top nav and
  // as an "About me" button in the footer of every page.
  aboutUrl: 'https://bladelow.github.io',

  // --- Admin panel (admin.html) -------------------------------------------
  // 1) Discord OAuth2 application client ID.
  //    https://discord.com/developers/applications -> OAuth2 -> Client ID.
  //    Add this redirect URI to the app:
  //      http://localhost:4000/admin.html   (local dev)
  //      https://<your-site>/admin.html     (production)
  discordClientId: '1570866481150034011',

  // 2) Google OAuth 2.0 "Web application" client ID.
  //    https://console.cloud.google.com/apis/credentials
  //    Authorized JavaScript origins: http://localhost:4000 and your site origin.
  //    Scope requested: https://www.googleapis.com/auth/drive
  googleClientId: '459922819681-ve4hldnbi4uq0batjkmp216mp6dphsne.apps.googleusercontent.com',

  // 3) Discord user IDs allowed into the admin panel.
  //    Enable Developer Mode in Discord, right-click your name -> Copy User ID.
  //    IMPORTANT: keep the ID in QUOTES. Discord IDs are 64-bit and lose
  //    precision if written as a number (1351956984597053463 -> ...400).
  adminDiscordIds: ['1351956984597053463'],
};
