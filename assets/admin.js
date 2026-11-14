/*
 * Blade Archive - admin panel.
 *
 * Static, no backend. Two independent logins:
 *   - Discord (OAuth2 implicit) is the sign-in gate. Only IDs in
 *     CONFIG.adminDiscordIds may use the panel.
 *   - Google (OAuth2 token client, scope .../auth/drive) is what actually
 *     authorises reading/writing the content and meta folders. Because the
 *     folders belong to the signed-in Google account, the Discord gate can be
 *     bypassed in devtools but the Drive token cannot.
 *
 * Uploads go straight to Drive (resumable), so file size is not limited by any
 * server. Metadata is a <base>.json file in the meta folder, matching core.js.
 */
(function () {
  'use strict';

  var O = window.ODDS || {};
  var CONFIG = window.ODDS_CONFIG || {};
  var $ = O.$ || function (sel, root) { return (root || document).querySelector(sel); };

  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
  var DISCORD_API = 'https://discord.com/api';
  var JSON_MIME = 'application/json';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';

  var state = {
    discordToken: null,
    discordUser: null,
    isAdmin: false,
    googleToken: null,
    tokenClient: null,
    items: [],
    editing: null,
  };

  /* ---- small helpers ---------------------------------------------------- */

  function esc(v) {
    return O.escapeHtml ? O.escapeHtml(v) : String(v == null ? '' : v);
  }
  function baseName(name) {
    var dot = String(name || '').lastIndexOf('.');
    return dot > 0 ? String(name).slice(0, dot) : String(name || '');
  }
  function extName(name) {
    var dot = String(name || '').lastIndexOf('.');
    return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : '';
  }
  function kindFromMime(mime) {
    if (!mime) return 'file';
    if (mime.indexOf('image/') === 0) return 'image';
    if (mime.indexOf('video/') === 0) return 'video';
    if (mime.indexOf('audio/') === 0) return 'audio';
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
    return 'file';
  }
  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function randomState() {
    var s = '';
    for (var i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  function typeIcon(type) {
    return ({ image: '\uD83D\uDDBC\uFE0F', video: '\uD83C\uDFAC', audio: '\uD83C\uDFB5', html: '\uD83C\uDFAE', file: '\uD83D\uDCC4' })[type] || '\uD83D\uDCC4';
  }
  function typeLabel(type) {
    return ({ image: 'Image', video: 'Video', audio: 'Audio', html: 'HTML Game', file: 'File' })[type] || 'File';
  }
  function thumbUrl(item) {
    if (item.thumbId || item.fileId) {
      if (item.type === 'html') return '';
      return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(item.thumbId || item.fileId) + '&sz=w120';
    }
    return '';
  }
  function setStatus(el, msg, cls) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'admin-status' + (cls ? ' ' + cls : '');
  }
  function reportError(statusEl, where, err) {
    var msg = err && err.message ? err.message : String(err);
    if (msg.indexOf('401') >= 0 || msg.indexOf('403') >= 0) {
      state.googleToken = null;
      render();
      setStatus($('#app-status'), 'Google session expired. Connect Google Drive again.', 'err');
      return;
    }
    setStatus(statusEl || $('#app-status'), where + ': ' + msg, 'err');
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---- config ----------------------------------------------------------- */

  function configReady() {
    return !!(CONFIG.discordClientId && CONFIG.googleClientId &&
      Array.isArray(CONFIG.adminDiscordIds) && CONFIG.adminDiscordIds.length);
  }
  function discordRedirectUri() { return location.origin + location.pathname; }

  /* ---- Discord (implicit) ---------------------------------------------- */

  function startDiscordLogin() {
    var st = randomState();
    try { sessionStorage.setItem('ods-discord-state', st); } catch (e) {}
    var url = 'https://discord.com/oauth2/authorize' +
      '?response_type=token' +
      '&client_id=' + encodeURIComponent(CONFIG.discordClientId) +
      '&scope=identify' +
      '&state=' + encodeURIComponent(st) +
      '&redirect_uri=' + encodeURIComponent(discordRedirectUri());
    location.href = url;
  }

  function parseHash() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return null;
    var out = {};
    hash.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    return out;
  }

  async function discordMe(token) {
    var res = await fetch(DISCORD_API + '/users/@me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Discord verification failed (' + res.status + ')');
    return res.json();
  }

  function isAdminId(id) {
    return (CONFIG.adminDiscordIds || []).some(function (x) { return String(x) === String(id); });
  }

  async function handleDiscordCallback() {
    var frag = parseHash();
    if (!frag || !frag.access_token) return false;
    var saved = null;
    try { saved = sessionStorage.getItem('ods-discord-state'); } catch (e) {}
    if (frag.state && saved && frag.state !== saved) {
      setStatus($('#login-status'), 'Discord login state mismatch. Try again.', 'err');
      return false;
    }
    state.discordToken = frag.access_token;
    try {
      state.discordUser = await discordMe(frag.access_token);
    } catch (err) {
      setStatus($('#login-status'), err.message, 'err');
      return false;
    }
    state.isAdmin = isAdminId(state.discordUser.id);
    try { sessionStorage.removeItem('ods-discord-state'); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    return true;
  }

  /* ---- Google (GIS token client) --------------------------------------- */

  function initGoogle() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
    try {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.googleClientId,
        scope: DRIVE_SCOPE,
        callback: function (resp) {
          if (!resp || resp.error || !resp.access_token) {
            var err = (resp && resp.error) || 'no token';
            var help = {
              access_denied: 'Access denied. In Google Cloud Console: (1) OAuth consent screen -> add your Google account under Test users, (2) add the https://www.googleapis.com/auth/drive scope, (3) enable the Google Drive API, (4) add this exact origin under Authorized JavaScript origins.',
              popup_closed: 'Popup closed before finishing. Allow popups for this site, then try again.',
              popup_blocked: 'Popup blocked. Allow popups for this site, then try again.',
              idpiframe_initialization_failed: 'Google sign-in could not start. Add this exact origin to Authorized JavaScript origins: ' + location.origin,
            }[err];
            setStatus($('#app-status'), 'Google sign-in failed: ' + (help || err), 'err');
            return;
          }
          state.googleToken = resp.access_token;
          setStatus($('#app-status'), 'Google Drive connected.', 'ok');
          render();
          loadItems();
        },
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  function connectGoogle() {
    if (!state.tokenClient) {
      setStatus($('#app-status'), 'Google sign-in is still loading. Try again in a moment.', 'err');
      return;
    }
    try {
      state.tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setStatus($('#app-status'), 'Google sign-in failed: ' + err.message, 'err');
    }
  }

  /* ---- Drive API -------------------------------------------------------- */

  function authHeaders(extra) {
    var h = { Authorization: 'Bearer ' + state.googleToken };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  async function driveList(folderId) {
    var q = "'" + folderId + "' in parents and trashed = false";
    var fields = 'files(id,name,mimeType,size,createdTime,modifiedTime)';
    var url = 'https://www.googleapis.com/drive/v3/files' +
      '?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent(fields) +
      '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true';
    var res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Drive list failed (' + res.status + ')');
    var data = await res.json();
    return data.files || [];
  }

  async function driveReadText(fileId) {
    var res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media',
      { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) throw new Error('Drive read failed (' + res.status + ')');
    return res.text();
  }

  async function driveDelete(fileId) {
    var res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId),
      { method: 'DELETE', headers: authHeaders() });
    if (!res.ok && res.status !== 404) throw new Error('Delete failed (' + res.status + ')');
  }

  // Create a text file (metadata JSON) with a multipart upload.
  async function driveCreateText(name, content, folderId, mime) {
    var boundary = '-------ods' + Date.now() + Math.floor(Math.random() * 1000);
    var meta = JSON.stringify({ name: name, parents: [folderId], mimeType: mime || JSON_MIME });
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      meta + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: ' + (mime || JSON_MIME) + '\r\n\r\n' +
      content + '\r\n' +
      '--' + boundary + '--';
    var res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }), body: body });
    if (!res.ok) throw new Error('Create file failed (' + res.status + ')');
    return res.json();
  }

  // Replace the bytes of an existing file (metadata JSON update).
  async function driveUpdateText(fileId, content, mime) {
    var res = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(fileId) + '?uploadType=media',
      { method: 'PATCH', headers: authHeaders({ 'Content-Type': mime || JSON_MIME }), body: content });
    if (!res.ok) throw new Error('Update file failed (' + res.status + ')');
    return res.json();
  }

  // Resumable upload for arbitrary file sizes. Falls back to multipart when the
  // Location header is not readable (small files only).
  function driveUploadFile(file, folderId, onProgress) {
    return new Promise(async function (resolve, reject) {
      try {
        var initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
          {
            method: 'POST',
            headers: authHeaders({
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Type': file.type || 'application/octet-stream',
              'X-Upload-Content-Length': String(file.size),
            }),
            body: JSON.stringify({ name: file.name, parents: [folderId] }),
          });
        if (!initRes.ok) throw new Error('Upload start failed (' + initRes.status + ')');

        var location = initRes.headers.get('Location');
        if (!location) {
          // CORS may hide Location. Fall back to a simple multipart upload.
          if (file.size <= 5 * 1024 * 1024) {
            var boundary = '-------ods' + Date.now() + Math.floor(Math.random() * 1000);
            var meta = JSON.stringify({ name: file.name, parents: [folderId] });
            var body =
              '--' + boundary + '\r\n' +
              'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
              meta + '\r\n' +
              '--' + boundary + '\r\n' +
              'Content-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n';
            var full = await file.arrayBuffer();
            var bytes = new Uint8Array(full);
            var blob = new Blob([body, bytes, '\r\n--' + boundary + '--']);
            var res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
              { method: 'POST', headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }), body: blob });
            if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
            if (onProgress) onProgress(1);
            resolve(await res.json());
            return;
          }
          throw new Error('Upload could not start (Location header unavailable).');
        }

        var xhr = new XMLHttpRequest();
        xhr.open('PUT', location, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (onProgress) onProgress(1);
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { resolve({ id: null }); }
          } else {
            reject(new Error('Upload failed (' + xhr.status + ')'));
          }
        };
        xhr.onerror = function () { reject(new Error('Upload network error')); };
        xhr.send(file);
      } catch (err) {
        reject(err);
      }
    });
  }

  /* ---- data ------------------------------------------------------------- */

  async function loadItems() {
    var itemsEl = $('#items');
    if (!state.googleToken) {
      if (itemsEl) itemsEl.innerHTML = '<div class="admin-empty">Connect Google Drive to load content.</div>';
      return;
    }
    if (itemsEl) itemsEl.innerHTML = '<div class="loading-box">Loading items&hellip;</div>';
    try {
      var contentFiles = (await driveList(CONFIG.contentFolderId)).filter(function (f) {
        return f.mimeType !== FOLDER_MIME;
      });
      var metaFiles = await driveList(CONFIG.metaFolderId);
      var metaByName = {};
      metaFiles.forEach(function (f) { metaByName[f.name.toLowerCase()] = f; });

      var items = await Promise.all(contentFiles.map(async function (file) {
        var base = baseName(file.name).toLowerCase();
        var meta = { title: baseName(file.name), description: '', type: kindFromMime(file.mimeType), tags: [], date: '' };
        var jsonFile = metaByName[base + '.json'];
        if (jsonFile) {
          try { meta = Object.assign(meta, JSON.parse(await driveReadText(jsonFile.id))); } catch (e) {}
        }
        var thumb = metaByName[base + '.jpg'] || metaByName[base + '.jpeg'] ||
          metaByName[base + '.png'] || metaByName[base + '.webp'] ||
          metaByName[base + '.thumb.jpg'] || metaByName[base + '.thumb.png'];
        return {
          id: file.id,
          name: file.name,
          base: base,
          fileId: file.id,
          mime: file.mimeType,
          size: file.size,
          created: file.createdTime ? file.createdTime.slice(0, 10) : '',
          meta: meta,
          jsonName: base + '.json',
          metaFileId: jsonFile ? jsonFile.id : '',
          thumbId: thumb ? thumb.id : '',
          thumbName: thumb ? thumb.name : '',
        };
      }));

      items.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      state.items = items;
      renderItems();
    } catch (err) {
      reportError(null, 'Could not load content', err);
      if (itemsEl) itemsEl.innerHTML = '<div class="error-box">Could not load content: ' + esc(err.message) + '</div>';
    }
  }

  function metaStatus(item) {
    return item.metaFileId ? 'has metadata' : 'no metadata';
  }

  function renderItems() {
    var itemsEl = $('#items');
    if (!itemsEl) return;
    if (!state.items.length) {
      itemsEl.innerHTML = '<div class="admin-empty">No content yet. Use &ldquo;Upload content&rdquo; to add the first item.</div>';
      return;
    }
    var rows = state.items.map(function (item) {
      var t = item.meta.type || 'file';
      var thumb = thumbUrl(item);
      var thumbHtml = thumb
        ? '<img class="thumb-sm" src="' + esc(thumb) + '" alt="" loading="lazy">'
        : '<span class="thumb-fallback">' + typeIcon(t) + '</span>';
      return '<tr data-id="' + esc(item.id) + '">' +
        '<td>' + thumbHtml + '</td>' +
        '<td><b>' + esc(item.meta.title || item.name) + '</b>' +
          (item.meta.title && item.meta.title !== item.name ? '<br><span class="hint-inline">' + esc(item.name) + '</span>' : '') +
          '</td>' +
        '<td>' + typeLabel(t) + '</td>' +
        '<td>' + esc(item.meta.date || item.created) + '</td>' +
        '<td>' + (item.metaFileId ? '<span style="color:var(--green)">yes</span>' : '<span style="color:var(--red)">no</span>') + '</td>' +
        '<td class="row-actions">' +
          '<button type="button" class="button" data-act="edit">Edit</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    itemsEl.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th></th><th>Title / file</th><th>Type</th><th>Date</th><th>Metadata</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    Array.prototype.forEach.call(itemsEl.querySelectorAll('tr[data-id]'), function (row) {
      var id = row.getAttribute('data-id');
      var item = state.items.filter(function (x) { return String(x.id) === String(id); })[0];
      var btn = row.querySelector('[data-act="edit"]');
      if (btn && item) btn.addEventListener('click', function () { openEdit(item); });
    });
  }

  /* ---- edit modal ------------------------------------------------------- */

  function openEdit(item) {
    state.editing = item;
    var m = item.meta || {};
    $('#ed-title').value = m.title || '';
    $('#ed-desc').value = m.description || '';
    $('#ed-type').value = m.type || kindFromMime(item.mime);
    $('#ed-date').value = m.date || item.created || todayISO();
    $('#ed-tags').value = Array.isArray(m.tags) ? m.tags.join(', ') : '';
    $('#ed-thumb').value = '';
    $('#ed-file').textContent = 'File: ' + item.name + (item.thumbId ? ' (thumbnail: ' + item.thumbName + ')' : '');
    setStatus($('#ed-status'), '');
    $('#edit-modal').hidden = false;
  }

  function closeEdit() {
    $('#edit-modal').hidden = true;
    state.editing = null;
  }

  async function saveEdit() {
    var item = state.editing;
    if (!item) return;
    var tagsRaw = $('#ed-tags').value;
    var tags = tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var meta = {
      title: String($('#ed-title').value || '').trim() || baseName(item.name),
      description: String($('#ed-desc').value || ''),
      type: $('#ed-type').value || kindFromMime(item.mime),
      tags: tags,
      date: String($('#ed-date').value || ''),
    };
    setStatus($('#ed-status'), 'Saving&hellip;', 'busy');
    try {
      if (item.metaFileId) {
        await driveUpdateText(item.metaFileId, JSON.stringify(meta, null, 2), JSON_MIME);
      } else {
        var created = await driveCreateText(item.jsonName, JSON.stringify(meta, null, 2), CONFIG.metaFolderId, JSON_MIME);
        item.metaFileId = created.id;
      }
      var thumbFile = $('#ed-thumb').files && $('#ed-thumb').files[0];
      if (thumbFile) {
        var ext = extName(thumbFile.name) || 'jpg';
        var thumbName = item.base + '.' + ext;
        await driveUploadFile(new File([thumbFile], thumbName, { type: thumbFile.type }), CONFIG.metaFolderId);
        if (item.thumbId) { try { await driveDelete(item.thumbId); } catch (e) {} }
        item.thumbId = '';
        item.thumbName = thumbName;
      }
      item.meta = meta;
      setStatus($('#ed-status'), 'Saved.', 'ok');
      toast('Metadata saved.');
      await loadItems();
      closeEdit();
    } catch (err) {
      reportError($('#ed-status'), 'Save failed', err);
    }
  }

  async function deleteItem() {
    var item = state.editing;
    if (!item) return;
    if (!confirm('Delete "' + (item.meta.title || item.name) + '" from Drive? This cannot be undone.')) return;
    setStatus($('#ed-status'), 'Deleting&hellip;', 'busy');
    try {
      await driveDelete(item.fileId);
      if (item.metaFileId) { try { await driveDelete(item.metaFileId); } catch (e) {} }
      if (item.thumbId) { try { await driveDelete(item.thumbId); } catch (e) {} }
      setStatus($('#ed-status'), 'Deleted.', 'ok');
      toast('Item deleted.');
      closeEdit();
      await loadItems();
    } catch (err) {
      reportError($('#ed-status'), 'Delete failed', err);
    }
  }

  /* ---- upload ----------------------------------------------------------- */

  function openUpload() {
    $('#upload-box').hidden = false;
    $('#up-file').value = '';
    $('#up-title').value = '';
    $('#up-desc').value = '';
    $('#up-type').value = 'auto';
    $('#up-tags').value = '';
    $('#up-date').value = todayISO();
    $('#up-thumb').value = '';
    $('#up-progress').hidden = true;
    $('#up-file').focus();
  }

  function closeUpload() {
    $('#upload-box').hidden = true;
  }

  function setProgress(pct, text) {
    var box = $('#up-progress');
    box.hidden = false;
    box.querySelector('.admin-progress-bar span').style.width = Math.max(0, Math.min(100, pct)) + '%';
    box.querySelector('.admin-progress-text').textContent = text || '';
  }

  async function submitUpload() {
    var file = $('#up-file').files && $('#up-file').files[0];
    if (!file) { toast('Choose a file first.'); return; }
    var title = String($('#up-title').value || '').trim();
    if (!title) title = baseName(file.name);
    var desc = String($('#up-desc').value || '');
    var typeSel = $('#up-type').value;
    var type = typeSel === 'auto' ? kindFromMime(file.type) : typeSel;
    var tags = String($('#up-tags').value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var date = String($('#up-date').value || todayISO());

    var btn = $('#up-submit');
    btn.disabled = true;
    setProgress(0, 'Uploading ' + file.name + '\u2026');
    try {
      await driveUploadFile(file, CONFIG.contentFolderId, function (p) {
        setProgress(Math.round(p * 100), 'Uploading ' + file.name + ' \u2014 ' + Math.round(p * 100) + '%');
      });

      var base = baseName(file.name).toLowerCase();
      var meta = { title: title, description: desc, type: type, tags: tags, date: date };
      setProgress(96, 'Writing metadata\u2026');
      var created = await driveCreateText(base + '.json', JSON.stringify(meta, null, 2), CONFIG.metaFolderId, JSON_MIME);

      var thumbFile = $('#up-thumb').files && $('#up-thumb').files[0];
      if (thumbFile) {
        setProgress(98, 'Uploading thumbnail\u2026');
        var ext = extName(thumbFile.name) || 'jpg';
        await driveUploadFile(new File([thumbFile], base + '.' + ext, { type: thumbFile.type }), CONFIG.metaFolderId);
      }

      setProgress(100, 'Done.');
      toast('Uploaded \u201C' + title + '\u201D.');
      closeUpload();
      await loadItems();
    } catch (err) {
      setProgress(0, '');
      reportError(null, 'Upload failed', err);
      toast('Upload failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---- generate metadata for existing items ----------------------------- */

  async function generateMissing() {
    if (!state.items.length) await loadItems();
    var missing = state.items.filter(function (it) { return !it.metaFileId; });
    if (!missing.length) { toast('Every item already has metadata.'); return; }
    setStatus($('#app-status'), 'Generating ' + missing.length + ' metadata file(s)\u2026', 'busy');
    var made = 0;
    for (var i = 0; i < missing.length; i++) {
      var it = missing[i];
      var meta = {
        title: it.meta.title || baseName(it.name),
        description: it.meta.description || '',
        type: it.meta.type || kindFromMime(it.mime),
        tags: it.meta.tags || [],
        date: it.meta.date || it.created || todayISO(),
      };
      try {
        var created = await driveCreateText(it.jsonName, JSON.stringify(meta, null, 2), CONFIG.metaFolderId, JSON_MIME);
        it.metaFileId = created.id;
        it.meta = meta;
        made++;
      } catch (e) {}
    }
    setStatus($('#app-status'), 'Created ' + made + ' metadata file(s).', 'ok');
    toast('Created ' + made + ' metadata file(s).');
    await loadItems();
  }

  /* ---- render ----------------------------------------------------------- */

  function render() {
    var setupBox = $('#setup-box');
    var loginBox = $('#login-box');
    var app = $('#app');
    var discordBtn = $('#discord-login');
    var googleBtn = $('#google-login');
    var signOut = $('#sign-out');

    if (!configReady()) {
      setupBox.hidden = false;
      loginBox.hidden = true;
      app.hidden = true;
      $('#discord-redirect').textContent = discordRedirectUri();
      $('#google-origin').textContent = location.origin;
      return;
    }
    setupBox.hidden = true;

    if (!state.isAdmin) {
      loginBox.hidden = false;
      app.hidden = true;
      signOut.hidden = true;
      setStatus($('#login-status'), state.discordUser
        ? ('Signed in as ' + state.discordUser.username + ' (' + state.discordUser.id + '), but this ID is not an admin.')
        : '', state.discordUser ? 'err' : '');
      return;
    }

    loginBox.hidden = true;
    app.hidden = false;
    signOut.hidden = false;

    // Account sidebar
    $('#acct-discord').textContent = state.discordUser
      ? (state.discordUser.username + ' #' + (state.discordUser.discriminator || '0') + ' (' + state.discordUser.id + ')')
      : '\u2014';
    $('#acct-google').textContent = state.googleToken ? 'connected' : 'not connected';
    $('#acct-content').textContent = CONFIG.contentFolderId || '\u2014';
    $('#acct-meta').textContent = CONFIG.metaFolderId || '\u2014';

    var connectBtn = $('#google-connect');
    if (connectBtn) connectBtn.hidden = !!state.googleToken;
    var uploadBtn = $('#new-upload');
    if (uploadBtn) uploadBtn.disabled = !state.googleToken;
    var genBtn = $('#generate-meta');
    if (genBtn) genBtn.disabled = !state.googleToken;

    if (!state.googleToken) {
      setStatus($('#app-status'), 'Connect Google Drive to upload and edit.', 'busy');
      $('#items').innerHTML = '<div class="admin-empty">Connect Google Drive to load content.</div>';
    } else {
      setStatus($('#app-status'), 'Google Drive connected.', 'ok');
    }
  }

  /* ---- init ------------------------------------------------------------- */

  async function init() {
    if (O.initTheme) O.initTheme();

    // Discord callback first (hash may contain the token).
    try {
      await handleDiscordCallback();
    } catch (e) {}

    // Google GIS may still be loading; retry until it is available.
    var tries = 0;
    (function tryInitGoogle() {
      if (initGoogle()) return;
      if (++tries > 40) return;
      setTimeout(tryInitGoogle, 150);
    })();

    $('#discord-login').addEventListener('click', startDiscordLogin);
    $('#google-login').addEventListener('click', connectGoogle);
    $('#google-connect').addEventListener('click', connectGoogle);
    $('#new-upload').addEventListener('click', openUpload);
    $('#reload-items').addEventListener('click', loadItems);
    $('#generate-meta').addEventListener('click', generateMissing);
    $('#up-submit').addEventListener('click', submitUpload);
    $('#up-cancel').addEventListener('click', closeUpload);
    $('#ed-save').addEventListener('click', saveEdit);
    $('#ed-delete').addEventListener('click', deleteItem);
    $('#ed-close').addEventListener('click', closeEdit);
    $('#sign-out').addEventListener('click', function () {
      state.discordToken = null;
      state.discordUser = null;
      state.isAdmin = false;
      state.googleToken = null;
      state.items = [];
      render();
    });

    render();
    if (state.isAdmin && state.googleToken) loadItems();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();