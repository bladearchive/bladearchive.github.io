/*
 * Blade Archive - shared browser core.
 * Loaded by index.html (gallery) and item.html (detail page).
 * Exposes window.ODDS so both pages share manifest loading, Drive helpers,
 * theming and site settings.
 */
(function () {
  'use strict';

  var CONFIG = window.ODDS_CONFIG || {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function typeLabel(type) {
    return ({ image: 'Image', video: 'Video', audio: 'Audio', file: 'File' })[type] || 'File';
  }

  function typeIcon(type) {
    return ({ image: '\uD83D\uDDBC\uFE0F', video: '\uD83C\uDFAC', audio: '\uD83C\uDFB5', file: '\uD83D\uDCC4' })[type] || '\uD83D\uDCC4';
  }

  // Theme -------------------------------------------------------------------
  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    var btn = $('#theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '\u2600\uFE0F Light' : '\uD83C\uDF19 Dark';
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem('ods-theme'); } catch (err) {}
    var theme = (stored === 'dark' || stored === 'light') ? stored : (systemPrefersDark() ? 'dark' : 'light');
    applyTheme(theme);

    var btn = $('#theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('ods-theme', next); } catch (err) {}
        applyTheme(next);
      });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function (event) {
        var saved = null;
        try { saved = localStorage.getItem('ods-theme'); } catch (err) {}
        if (saved !== 'dark' && saved !== 'light') applyTheme(event.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  // Google Drive public links. Files must be shared "Anyone with the link".
  var DRIVE = {
    thumb: function (id, size) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (size || 600); },
    full: function (id) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w2400'; },
    preview: function (id) { return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview'; },
    download: function (id) { return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id); }
  };

  // Repo-hosted media (GitHub Pages) or Google Drive media.
  function srcOf(item) { return item.src || item.url || ''; }
  function hasSrc(item) { return !!(item.src || item.url); }
  function thumbUrl(item) {
    if (item.thumb) return item.thumb;
    if (hasSrc(item) && item.type === 'image') return srcOf(item);
    if (item.thumbId || item.fileId) return DRIVE.thumb(item.thumbId || item.fileId, 600);
    return '';
  }
  function fullUrl(item) {
    if (hasSrc(item)) return srcOf(item);
    if (item.fileId) return DRIVE.full(item.fileId);
    return '';
  }
  function downloadUrl(item) {
    if (hasSrc(item)) return srcOf(item);
    if (item.fileId) return DRIVE.download(item.fileId);
    return '';
  }

  function isNew(item) {
    if (!item.date) return false;
    var then = new Date(item.date).getTime();
    if (isNaN(then)) return false;
    return (Date.now() - then) < 14 * 24 * 60 * 60 * 1000 && (Date.now() - then) > -24 * 60 * 60 * 1000;
  }

  function baseName(name) {
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function kindFromMime(mime) {
    if (!mime) return 'file';
    if (mime.indexOf('image/') === 0) return 'image';
    if (mime.indexOf('video/') === 0) return 'video';
    if (mime.indexOf('audio/') === 0) return 'audio';
    return 'file';
  }

  // Manifest loading --------------------------------------------------------
  async function driveList(folderId) {
    var q = "'" + folderId + "' in parents and trashed = false";
    var fields = 'files(id,name,mimeType,size,thumbnailLink,webContentLink,createdTime,modifiedTime)';
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent(fields) +
      '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=' + encodeURIComponent(CONFIG.driveApiKey);
    var res = await fetch(url);
    if (!res.ok) throw new Error('Drive folder list failed (' + res.status + ')');
    var data = await res.json();
    return data.files || [];
  }

  async function driveRead(fileId) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?alt=media&key=' + encodeURIComponent(CONFIG.driveApiKey);
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Drive file read failed (' + res.status + ')');
    return res.json();
  }

  async function loadFromFolders() {
    var contentFiles = (await driveList(CONFIG.contentFolderId)).filter(function (file) {
      return file.mimeType !== 'application/vnd.google-apps.folder';
    });
    var metaFiles = await driveList(CONFIG.metaFolderId);
    var metaByName = {};
    metaFiles.forEach(function (file) { metaByName[file.name.toLowerCase()] = file; });

    var items = await Promise.all(contentFiles.map(async function (file) {
      var base = baseName(file.name).toLowerCase();
      var meta = {};
      var metaJson = metaByName[base + '.json'];
      if (metaJson) {
        try { meta = await driveRead(metaJson.id); } catch (err) { meta = {}; }
      }
      var thumb = metaByName[base + '.jpg'] || metaByName[base + '.jpeg'] ||
        metaByName[base + '.png'] || metaByName[base + '.webp'] ||
        metaByName[base + '.thumb.jpg'] || metaByName[base + '.thumb.png'];
      return {
        id: file.id,
        title: meta.title || baseName(file.name),
        description: meta.description || '',
        type: meta.type || kindFromMime(file.mimeType),
        fileId: file.id,
        thumbId: thumb ? thumb.id : '',
        tags: meta.tags || [],
        date: meta.date || (file.createdTime ? file.createdTime.slice(0, 10) : ''),
      };
    }));

    var site = {};
    var siteJson = metaByName['site.json'];
    if (siteJson) {
      try { site = await driveRead(siteJson.id); } catch (err) { site = {}; }
    }
    return { site: site, items: items };
  }

  async function loadManifest() {
    if (CONFIG.driveApiKey && CONFIG.contentFolderId && CONFIG.metaFolderId) {
      try { return await loadFromFolders(); } catch (err) { /* fall through */ }
    }
    if (CONFIG.driveApiKey && CONFIG.manifestFileId) {
      try { return await driveRead(CONFIG.manifestFileId); } catch (err) { /* fall through */ }
    }
    if (CONFIG.manifestFileId) {
      try {
        var direct = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(CONFIG.manifestFileId);
        var directRes = await fetch(direct, { cache: 'no-store' });
        if (directRes.ok) return await directRes.json();
      } catch (err) { /* fall through */ }
    }
    var res = await fetch('content.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('content.json not found next to index.html');
    return res.json();
  }

  // Site settings -----------------------------------------------------------
  function applySite(site) {
    site = site || {};
    if (site.title) document.title = site.title + ' - a personal archive';
    if (site.tagline) { var tagline = $('#tagline'); if (tagline) tagline.textContent = site.tagline; }
    if (site.footer) { var footer = $('#footer-text'); if (footer) footer.textContent = site.footer; }
    if (site.announcement) {
      var text = $('#marquee-text');
      var marquee = $('#marquee');
      if (text) text.textContent = site.announcement;
      if (marquee) marquee.hidden = false;
    }
    if (site.updated) { var upd = $('#header-updated'); if (upd) upd.textContent = 'Last updated ' + site.updated; }
  }

  window.ODDS = {
    CONFIG: CONFIG,
    $: $,
    $$: $$,
    escapeHtml: escapeHtml,
    typeLabel: typeLabel,
    typeIcon: typeIcon,
    systemPrefersDark: systemPrefersDark,
    applyTheme: applyTheme,
    initTheme: initTheme,
    DRIVE: DRIVE,
    srcOf: srcOf,
    hasSrc: hasSrc,
    thumbUrl: thumbUrl,
    fullUrl: fullUrl,
    downloadUrl: downloadUrl,
    isNew: isNew,
    baseName: baseName,
    kindFromMime: kindFromMime,
    loadManifest: loadManifest,
    applySite: applySite
  };
})();