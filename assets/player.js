/*
 * Blade Archive - custom media player engine.
 *
 * Why this exists: the Google Drive /preview iframe does not match the site
 * theme and is blocked in some browsers (third-party cookies / tracking
 * protection / ORB). Instead we download the media bytes through the Drive API
 * (CORS-enabled) into a Blob and play them with native <video>/<audio>, wrapped
 * in our own retro-themed, YouTube-style overlay controls.
 *
 * Exposes window.ODDS.mountPlayer(root, item), .resolveMedia, .fetchDriveBlob,
 * .fmtTime.
 */
(function () {
  'use strict';

  var O = window.ODDS || {};
  var CONFIG = O.CONFIG || {};
  var $ = O.$ || function (sel, root) { return (root || document).querySelector(sel); };
  var escapeHtml = O.escapeHtml || function (v) { return String(v == null ? '' : v); };

  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var s = Math.floor(sec % 60);
    var m = Math.floor((sec / 60) % 60);
    var h = Math.floor(sec / 3600);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (h ? h + ':' + p(m) : m) + ':' + p(s);
  }

  // Download a Drive file through the API (CORS) with progress.
  async function fetchDriveBlob(fileId, onProgress) {
    // Download a Drive file. By default we use the Drive API alt=media endpoint.
    // If you set config.driveProxyUrl (a Cloudflare Worker / proxy), we use that
    // instead, because Google's alt=media endpoint is rate-limited/blocked for
    // some networks and drive.usercontent.google.com is CORS-blocked for browsers.
    var url;
    if (CONFIG.driveProxyUrl) {
      url = CONFIG.driveProxyUrl + (CONFIG.driveProxyUrl.indexOf('?') === -1 ? '?' : '&') + 'id=' + encodeURIComponent(fileId);
    } else {
      url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
        '?alt=media&key=' + encodeURIComponent(CONFIG.driveApiKey);
    }
    var res = await fetch(url);
    if (!res.ok) throw new Error('Media download failed (' + res.status + ')');
    var total = parseInt(res.headers.get('Content-Length') || '0', 10) || 0;

    if (!res.body || typeof res.body.getReader !== 'function') {
      var blob = await res.blob();
      if (onProgress) onProgress(1, 1);
      return blob;
    }

    var reader = res.body.getReader();
    var chunks = [];
    var received = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.length;
      if (onProgress) onProgress(received, total || received);
    }
    return new Blob(chunks, { type: res.headers.get('Content-Type') || 'application/octet-stream' });
  }

  // Resolve a media URL for an item.
  async function resolveMedia(item, onProgress) {
    if (O.hasSrc && O.hasSrc(item)) return { url: O.srcOf(item), revoke: false };

    if (item.type === 'image') {
      var iu = (O.fullUrl && O.fullUrl(item)) || (O.srcOf && O.srcOf(item)) || '';
      return { url: iu, revoke: false };
    }

    if (item.fileId) {
      if (!CONFIG.driveApiKey && !CONFIG.driveProxyUrl) {
        return { url: 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(item.fileId), revoke: false };
      }
      var blob = await fetchDriveBlob(item.fileId, onProgress);
      // Drive serves HTML as application/octet-stream; re-wrap with the real
      // MIME so the <iframe> renders it instead of downloading.
      if (item.mime && blob.type !== item.mime) {
        blob = new Blob([blob], { type: item.mime });
      }
      return { url: URL.createObjectURL(blob), revoke: true };
    }
    throw new Error('No media source for this item.');
  }

  function downloadName(item) {
    return (item.title || 'download').replace(/[\\/:*?"<>|]+/g, '_');
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildLoader() {
    var loader = el('div', 'mp-loader',
      '<div class="mp-loader-bar"><span></span></div>' +
      '<div class="mp-loader-text">Loading&hellip;</div>');
    var fill = $('.mp-loader-bar span', loader);
    var text = $('.mp-loader-text', loader);
    return {
      el: loader,
      set: function (received, total) {
        var pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        fill.style.width = pct + '%';
        text.textContent = total > 0 ? ('Loading ' + pct + '%') : 'Loading\u2026';
      },
      fail: function (msg) {
        var bar = $('.mp-loader-bar', loader);
        if (bar) bar.hidden = true;
        text.textContent = msg;
      },
      hide: function () { loader.hidden = true; }
    };
  }

  function toggleFullscreen(root) {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (root.requestFullscreen) {
      root.requestFullscreen().catch(function () {});
    }
  }

  // Transport for <video>/<audio> with YouTube-style overlay behavior.
  function bindTransport(root, media, overlay) {
    var playBtn = $('[data-act="play"]', root);
    var bigPlay = $('.mp-bigplay', root);
    var seek = $('.mp-seek', root);
    var curEl = $('[data-cur]', root);
    var durEl = $('[data-dur]', root);
    var muteBtn = $('[data-act="mute"]', root);
    var volEl = $('.mp-vol', root);
    var speedBtn = $('[data-act="speed"]', root);
    var speedIdx = 2;
    var hideTimer = 0;

    function showOverlay() {
      root.classList.add('mp-active');
      clearTimeout(hideTimer);
      if (!media.paused) {
        hideTimer = setTimeout(function () { root.classList.remove('mp-active'); }, 2600);
      }
    }
    function setPlayIcon() {
      var playing = !media.paused && !media.ended;
      if (playBtn) playBtn.textContent = playing ? '\u275A\u275A' : '\u25B6';
      if (bigPlay) bigPlay.hidden = playing;
      root.classList.toggle('is-playing', playing);
      if (playing) showOverlay(); else { root.classList.add('mp-active'); clearTimeout(hideTimer); }
    }
    function setMuteIcon() {
      var off = media.muted || media.volume === 0;
      if (muteBtn) {
        muteBtn.textContent = off ? '\uD83D\uDD07' : '\uD83D\uDD0A';
        muteBtn.setAttribute('aria-pressed', off ? 'true' : 'false');
      }
      var hint = $('.mp-sound-hint', root);
      if (hint) hint.hidden = !off;
    }
    function togglePlay() {
      if (media.paused) { media.play().catch(function () {}); } else { media.pause(); }
    }
    function seekBy(delta) {
      if (!isFinite(media.duration)) return;
      media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + delta));
    }

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (bigPlay) bigPlay.addEventListener('click', function (e) { e.stopPropagation(); togglePlay(); });

    if (seek) {
      seek.addEventListener('input', function () {
        if (isFinite(media.duration)) media.currentTime = (seek.value / 1000) * media.duration;
        showOverlay();
      });
    }

    if (volEl) {
      volEl.addEventListener('input', function () {
        media.volume = volEl.value / 100;
        media.muted = media.volume === 0;
        setMuteIcon();
        showOverlay();
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        media.muted = !media.muted;
        if (!media.muted && media.volume === 0) { media.volume = 0.6; if (volEl) volEl.value = '60'; }
        setMuteIcon();
        showOverlay();
      });
    }

    var soundHint = $('.mp-sound-hint', root);
    if (soundHint) {
      soundHint.addEventListener('click', function (e) {
        e.stopPropagation();
        media.muted = false;
        if (media.volume === 0) media.volume = 1;
        if (volEl) volEl.value = String(Math.round(media.volume * 100));
        setMuteIcon();
        showOverlay();
      });
    }

    if (speedBtn) {
      speedBtn.addEventListener('click', function () {
        speedIdx = (speedIdx + 1) % SPEEDS.length;
        media.playbackRate = SPEEDS[speedIdx];
        speedBtn.textContent = SPEEDS[speedIdx] + '\u00D7';
        showOverlay();
      });
    }

    var pipBtn = $('[data-act="pip"]', root);
    if (pipBtn) {
      pipBtn.addEventListener('click', function () {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(function () {});
        } else if (media.requestPictureInPicture) {
          media.requestPictureInPicture().catch(function () {});
        }
      });
    }

    var fullBtn = $('[data-act="full"]', root);
    if (fullBtn) fullBtn.addEventListener('click', function () { toggleFullscreen(root); });

    // Click the media itself to play/pause (YouTube-style).
    media.addEventListener('click', togglePlay);
    root.addEventListener('mousemove', showOverlay);
    root.addEventListener('mouseleave', function () { if (!media.paused) root.classList.remove('mp-active'); });
    overlay.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });

    media.addEventListener('play', setPlayIcon);
    media.addEventListener('pause', setPlayIcon);
    media.addEventListener('ended', function () { setPlayIcon(); if (seek) seek.value = '0'; });
    media.addEventListener('volumechange', setMuteIcon);
    media.addEventListener('loadedmetadata', function () {
      if (durEl) durEl.textContent = fmtTime(media.duration);
      media.playbackRate = SPEEDS[speedIdx];
      media.volume = 1;
      media.muted = false;
      if (volEl) volEl.value = '100';
      setMuteIcon();
    });
    media.addEventListener('timeupdate', function () {
      if (curEl) curEl.textContent = fmtTime(media.currentTime);
      if (seek && isFinite(media.duration) && media.duration > 0) {
        seek.value = String(Math.round((media.currentTime / media.duration) * 1000));
      }
    });

    setPlayIcon();
    setMuteIcon();

    return {
      keydown: function (e) {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        switch (e.key) {
          case ' ': case 'k': e.preventDefault(); togglePlay(); break;
          case 'ArrowRight': e.preventDefault(); seekBy(5); break;
          case 'ArrowLeft': e.preventDefault(); seekBy(-5); break;
          case 'ArrowUp': e.preventDefault(); media.volume = Math.min(1, media.volume + 0.1); if (volEl) volEl.value = String(media.volume * 100); setMuteIcon(); break;
          case 'ArrowDown': e.preventDefault(); media.volume = Math.max(0, media.volume - 0.1); if (volEl) volEl.value = String(media.volume * 100); setMuteIcon(); break;
          case 'm': case 'M': media.muted = !media.muted; setMuteIcon(); break;
          case 'f': case 'F': toggleFullscreen(root); break;
        }
      }
    };
  }

  function bindImageControls(root, img, overlay) {
    var scale = 1, tx = 0, ty = 0, min = 1, max = 8;
    var zoomEl = $('.mp-zoom', root);
    var dragging = false, sx = 0, sy = 0;

    function apply() {
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';
    }
    function setScale(next) {
      scale = Math.max(min, Math.min(max, next));
      if (scale === 1) { tx = 0; ty = 0; }
      apply();
    }

    var zin = $('[data-act="zoomin"]', root);
    var zout = $('[data-act="zoomout"]', root);
    var zreset = $('[data-act="zoomreset"]', root);
    if (zin) zin.addEventListener('click', function () { setScale(scale * 1.25); });
    if (zout) zout.addEventListener('click', function () { setScale(scale / 1.25); });
    if (zreset) zreset.addEventListener('click', function () { setScale(1); });

    var fullBtn = $('[data-act="full"]', root);
    if (fullBtn) fullBtn.addEventListener('click', function () { toggleFullscreen(root); });

    img.addEventListener('wheel', function (e) {
      e.preventDefault();
      setScale(scale * (e.deltaY < 0 ? 1.12 : 0.89));
    }, { passive: false });

    img.addEventListener('dblclick', function () { setScale(scale === 1 ? 2 : 1); });

    img.addEventListener('pointerdown', function (e) {
      if (scale === 1) return;
      dragging = true; sx = e.clientX - tx; sy = e.clientY - ty;
      img.setPointerCapture(e.pointerId);
      img.classList.add('is-grabbing');
    });
    img.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      tx = e.clientX - sx; ty = e.clientY - sy; apply();
    });
    function endDrag() { dragging = false; img.classList.remove('is-grabbing'); }
    img.addEventListener('pointerup', endDrag);
    img.addEventListener('pointercancel', endDrag);

    // Image overlay is always visible.
    root.classList.add('mp-active');

    return {
      keydown: function (e) {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.key === '+' || e.key === '=') { e.preventDefault(); setScale(scale * 1.25); }
        else if (e.key === '-') { e.preventDefault(); setScale(scale / 1.25); }
        else if (e.key === '0') { e.preventDefault(); setScale(1); }
        else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(root); }
      }
    };
  }

  // Mount the player for `item` into `root`. Returns { destroy }.
  function mountPlayer(root, item) {
    if (!root) return { destroy: function () {} };
    root.innerHTML = '';
    root.classList.add('mp');
    root.classList.add('mp-' + (item.type || 'file'));
    root.setAttribute('tabindex', '0');

    var type = item.type || 'file';
    var cleanups = [];
    var objectUrl = null;

    function cleanup() {
      cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      root.innerHTML = '';
    }

    // Non-previewable file (zip, etc.) -> download card.
    if (type === 'file') {
      var dl = (O.downloadUrl && O.downloadUrl(item)) || '';
      root.innerHTML =
        '<div class="mp-stage mp-file-stage">' +
          '<div class="mp-file-card">' +
            '<div class="mp-file-icon">\uD83D\uDCC4</div>' +
            '<div class="mp-file-name">' + escapeHtml(item.title) + '</div>' +
            (dl ? '<a class="button button-primary" href="' + escapeHtml(dl) + '" target="_blank" rel="noopener noreferrer" download="' + escapeHtml(downloadName(item)) + '">Download</a>' : '') +
          '</div>' +
        '</div>';
      return { destroy: cleanup };
    }

    // Interactive HTML content (a self-contained HTML game/demo) -> sandboxed iframe.
    if (type === 'html') {
      var dlHtml = (O.downloadUrl && O.downloadUrl(item)) || '';
      var srcHtml = (O.hasSrc && O.hasSrc(item)) ? O.srcOf(item) : '';
      root.innerHTML =
        '<div class="mp-stage mp-html-stage">' +
          '<div class="mp-html-bar">' +
            '<span class="mp-html-title">' + escapeHtml(item.title) + '</span>' +
            '<button type="button" class="mp-btn" data-act="reload" aria-label="Reload game">\u21BB Reload</button>' +
            (srcHtml ? '<a class="mp-btn" href="' + escapeHtml(srcHtml) + '" target="_blank" rel="noopener noreferrer">Open in new tab</a>' : '') +
            (dlHtml ? '<a class="mp-btn" href="' + escapeHtml(dlHtml) + '" download="' + escapeHtml(downloadName(item)) + '" aria-label="Download">\u2B07 Download</a>' : '') +
          '</div>' +
          '<div class="mp-html-frame-wrap">' +
            '<div class="mp-html-loader">Loading game&hellip;</div>' +
            '<iframe class="mp-html-frame" title="' + escapeHtml(item.title) + '" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-gamepad allow-downloads allow-forms allow-popups" allow="fullscreen; gamepad; autoplay"></iframe>' +
          '</div>' +
        '</div>';

      var frame = $('.mp-html-frame', root);
      var frameLoader = $('.mp-html-loader', root);
      var reloadBtn = $('[data-act="reload"]', root);

      function loadGame() {
        frameLoader.hidden = false;
        frameLoader.textContent = 'Loading game\u2026';
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        resolveMedia(item, function () {})
          .then(function (res) {
            objectUrl = res.revoke ? res.url : null;
            var onLoad = function () {
              frameLoader.hidden = true;
              frame.removeEventListener('load', onLoad);
            };
            frame.addEventListener('load', onLoad);
            frame.src = res.url;
          })
          .catch(function (err) {
            frameLoader.textContent = 'Could not load game: ' + (err && err.message ? err.message : 'unknown error');
          });
      }

      if (reloadBtn) reloadBtn.addEventListener('click', loadGame);
      loadGame();
      return { destroy: cleanup };
    }

    var isImage = type === 'image';
    var stage = el('div', 'mp-stage');

    var media;
    if (isImage) {
      media = el('img', 'mp-img');
      media.alt = item.title || '';
      media.loading = 'eager';
    } else {
      media = el(type === 'audio' ? 'audio' : 'video', 'mp-media');
      media.preload = 'auto';
      if (type === 'video') { media.playsInline = true; media.setAttribute('playsinline', ''); }
    }
    stage.appendChild(media);

    var loader = buildLoader();
    stage.appendChild(loader.el);

    // YouTube-style overlay container (seek + controls).
    var overlay = el('div', 'mp-overlay');
    var bar = el('div', 'mp-controls');
    overlay.appendChild(bar);
    stage.appendChild(overlay);

    if (type === 'video') {
      var big = el('button', 'mp-bigplay', '\u25B6');
      big.type = 'button';
      big.setAttribute('aria-label', 'Play');
      stage.appendChild(big);
    }

    if (type === 'video' || type === 'audio') {
      var soundHint = el('button', 'mp-sound-hint', '\uD83D\uDD0A Tap for sound');
      soundHint.type = 'button';
      soundHint.setAttribute('aria-label', 'Unmute and set volume to full');
      soundHint.hidden = true;
      stage.appendChild(soundHint);
    }

    if (type === 'audio') {
      var eq = el('div', 'mp-eq');
      eq.setAttribute('aria-hidden', 'true');
      eq.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
      stage.appendChild(eq);
      var title = el('div', 'mp-audio-title');
      title.textContent = item.title || '';
      stage.appendChild(title);
    }

    // Build control bar contents.
    if (isImage) {
      bar.innerHTML =
        '<div class="mp-controls-row">' +
          '<button type="button" class="mp-btn" data-act="zoomout" aria-label="Zoom out">\u2212</button>' +
          '<span class="mp-zoom">100%</span>' +
          '<button type="button" class="mp-btn" data-act="zoomin" aria-label="Zoom in">+</button>' +
          '<button type="button" class="mp-btn" data-act="zoomreset" aria-label="Reset zoom">Fit</button>' +
          '<span class="mp-spacer"></span>' +
          '<button type="button" class="mp-btn" data-act="full" aria-label="Fullscreen">\u26F6</button>' +
          (O.fullUrl && O.fullUrl(item) ? '<a class="mp-btn" href="' + escapeHtml(O.fullUrl(item)) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '') +
          (O.downloadUrl && O.downloadUrl(item) ? '<a class="mp-btn" href="' + escapeHtml(O.downloadUrl(item)) + '" download="' + escapeHtml(downloadName(item)) + '">Download</a>' : '') +
        '</div>';
    } else {
      // Seek line on its own row (YouTube-style), then the button row.
      bar.innerHTML =
        '<input type="range" class="mp-seek" min="0" max="1000" value="0" aria-label="Seek">' +
        '<div class="mp-controls-row">' +
          '<button type="button" class="mp-btn mp-play" data-act="play" aria-label="Play">\u25B6</button>' +
          '<span class="mp-time"><b data-cur>0:00</b> / <span data-dur>0:00</span></span>' +
          '<button type="button" class="mp-btn" data-act="mute" aria-label="Mute" aria-pressed="false">\uD83D\uDD0A</button>' +
          '<input type="range" class="mp-vol" min="0" max="100" value="100" aria-label="Volume">' +
          '<span class="mp-spacer"></span>' +
          '<button type="button" class="mp-btn mp-speed" data-act="speed" aria-label="Playback speed">1\u00D7</button>' +
          (type === 'video' ? '<button type="button" class="mp-btn" data-act="pip" aria-label="Picture in picture">PiP</button>' : '') +
          '<button type="button" class="mp-btn" data-act="full" aria-label="Fullscreen">\u26F6</button>' +
          (O.downloadUrl && O.downloadUrl(item) ? '<a class="mp-btn" href="' + escapeHtml(O.downloadUrl(item)) + '" download="' + escapeHtml(downloadName(item)) + '" aria-label="Download">\u2B07</a>' : '') +
        '</div>';
    }

    root.appendChild(stage);

    resolveMedia(item, function (received, total) { loader.set(received, total); }).then(function (res) {
      objectUrl = res.revoke ? res.url : null;
      media.src = res.url;

      if (isImage) {
        media.addEventListener('load', function () { loader.hide(); root.classList.add('is-ready'); });
        media.addEventListener('error', function () { loader.fail('Could not load image.'); });
        var imgCtl = bindImageControls(root, media, overlay);
        cleanups.push(keyHandler(root, imgCtl));
      } else {
        media.addEventListener('loadeddata', function () { loader.hide(); root.classList.add('is-ready'); });
        media.addEventListener('error', function () { loader.fail('Could not load media.'); });
        var ctl = bindTransport(root, media, overlay);
        cleanups.push(keyHandler(root, ctl));
      }
    }).catch(function (err) {
      loader.fail(err && err.message ? err.message : 'Could not load media.');
    });

    return { destroy: cleanup };
  }

  function keyHandler(root, handler) {
    function onKey(e) {
      var active = root === document.activeElement || root.matches(':hover') || root.contains(document.activeElement);
      if (!active) return;
      handler(e);
    }
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', function () { root.focus(); });
    return function () { document.removeEventListener('keydown', onKey); };
  }

  O.fmtTime = fmtTime;
  O.fetchDriveBlob = fetchDriveBlob;
  O.resolveMedia = resolveMedia;
  O.mountPlayer = mountPlayer;
})();