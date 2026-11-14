(function () {
  'use strict';

  var O = window.ODDS || {};
  var $ = O.$ || function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = O.$$ || function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var escapeHtml = O.escapeHtml || function (v) { return String(v == null ? '' : v); };
  var state = { items: [], site: {}, filter: '', query: '' };

  function itemHref(item) {
    return 'item.html?id=' + encodeURIComponent(item.id);
  }

  function matches(item) {
    if (state.filter && item.type !== state.filter) return false;
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var hay = (item.title + ' ' + (item.description || '') + ' ' + (item.tags || []).join(' ')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function card(item) {
    var url = O.thumbUrl ? O.thumbUrl(item) : '';
    var thumb = url
      ? '<img loading="lazy" src="' + escapeHtml(url) + '" alt="">'
      : '<span class="thumb-fallback">' + (O.typeIcon ? O.typeIcon(item.type) : '') + '</span>';
    var tags = (item.tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join('');
    var href = itemHref(item);
    return '' +
      '<article class="card">' +
        '<a class="card-thumb" href="' + escapeHtml(href) + '" aria-label="Open ' + escapeHtml(item.title) + '">' + thumb + '</a>' +
        '<div class="card-body">' +
          '<h3 class="card-title"><a href="' + escapeHtml(href) + '">' + escapeHtml(item.title) + '</a>' + (O.isNew && O.isNew(item) ? '<span class="new-flag">NEW</span>' : '') + '</h3>' +
          (item.description ? '<p class="card-desc">' + escapeHtml(item.description) + '</p>' : '') +
          '<div class="card-meta">' + escapeHtml(O.typeLabel ? O.typeLabel(item.type) : item.type) + (item.date ? ' &middot; ' + escapeHtml(item.date) : '') + '</div>' +
          (tags ? '<div class="card-tags">' + tags + '</div>' : '') +
        '</div>' +
      '</article>';
  }

  function renderMain() {
    var main = $('#main');
    var items = state.items.filter(matches);
    var html = '';

    if (state.site.intro) html += '<div class="intro"><p>' + escapeHtml(state.site.intro) + '</p></div>';

    html += '<div class="search-box"><input id="search" type="search" placeholder="Search the archive&hellip;" value="' + escapeHtml(state.query) + '"></div>';

    if (!items.length) {
      html += '<div class="empty">Nothing here yet. Add an item in <strong>content.json</strong>.</div>';
    } else {
      html += '<div class="grid">' + items.map(card).join('') + '</div>';
    }

    main.innerHTML = html;

    var search = $('#search');
    search.addEventListener('input', function (event) {
      state.query = event.target.value;
      var pos = event.target.selectionStart;
      renderMain();
      var again = $('#search');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
  }

  function renderNav() {
    var types = [];
    state.items.forEach(function (item) { if (item.type && types.indexOf(item.type) === -1) types.push(item.type); });
    var links = [{ value: '', label: 'Home' }].concat(types.map(function (t) { return { value: t, label: O.typeLabel(t) + 's' }; }));
    var nav = $('#nav-inner');
    var about = (O.CONFIG && O.CONFIG.aboutUrl) || '';
    var aboutLink = about
      ? '<span class="nav-sep">|</span><a class="nav-link" href="' + escapeHtml(about) + '" target="_blank" rel="noopener">About</a>'
      : '';
    nav.innerHTML = links.map(function (link, index) {
      var active = state.filter === link.value ? ' is-active' : '';
      var sep = index ? '<span class="nav-sep">|</span>' : '';
      return sep + '<a class="nav-link' + active + '" href="#/" data-filter="' + escapeHtml(link.value) + '">' + escapeHtml(link.label) + '</a>';
    }).join('') + aboutLink;
    $$('[data-filter]', nav).forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        state.filter = el.getAttribute('data-filter');
        renderNav();
        renderMain();
      });
    });
  }

  function renderSidebar() {
    var counts = { image: 0, video: 0, audio: 0, html: 0, file: 0, all: state.items.length };
    state.items.forEach(function (item) { if (counts[item.type] != null) counts[item.type] += 1; });

    var tags = {};
    state.items.forEach(function (item) {
      (item.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
    });
    var tagKeys = Object.keys(tags).sort();

    var html = '' +
      '<div class="box">' +
        '<div class="box-head">Archive Stats</div>' +
        '<div class="box-body">' +
          '<table class="stats-table">' +
            '<tr><td>Items</td><td>' + counts.all + '</td></tr>' +
            '<tr><td>Images</td><td>' + counts.image + '</td></tr>' +
            '<tr><td>Videos</td><td>' + counts.video + '</td></tr>' +
            '<tr><td>Audio</td><td>' + counts.audio + '</td></tr>' +
            '<tr><td>HTML</td><td>' + counts.html + '</td></tr>' +
            '<tr><td>Files</td><td>' + counts.file + '</td></tr>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div class="box">' +
        '<div class="box-head">Tags</div>' +
        '<div class="box-body">' +
          (tagKeys.length
            ? tagKeys.map(function (t) { return '<a class="tag" href="#/" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + ' (' + tags[t] + ')</a>'; }).join(' ')
            : '<span class="card-meta">No tags yet.</span>') +
        '</div>' +
      '</div>' +
      '<div class="box">' +
        '<div class="box-head">Surprise Me</div>' +
        '<div class="box-body"><button type="button" class="button random-button" id="random-btn">Open a random item</button></div>' +
      '</div>' +
      '<div class="box">' +
        '<div class="box-head">Status</div>' +
        '<div class="box-body">' +
          '<div class="status-line"><span>Archive</span><span class="status-dot">&#9679; online</span></div>' +
          '<div class="status-line"><span>Source</span><span>Google Drive</span></div>' +
        '</div>' +
      '</div>';

    $('#sidebar').innerHTML = html;

    $$('[data-tag]', $('#sidebar')).forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        state.query = el.getAttribute('data-tag');
        renderMain();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    $('#random-btn').addEventListener('click', function () {
      if (!state.items.length) return;
      var pick = state.items[Math.floor(Math.random() * state.items.length)];
      window.location.href = itemHref(pick);
    });
  }

  async function init() {
    if (O.initTheme) O.initTheme();
    try {
      var manifest = await O.loadManifest();
      state.items = Array.isArray(manifest.items) ? manifest.items : [];
      state.site = manifest.site || {};
      if (O.applySite) O.applySite(state.site);
      renderNav();
      renderMain();
      renderSidebar();
    } catch (err) {
      $('#main').innerHTML = '<div class="error-box"><strong>Could not load the archive.</strong><br>' + escapeHtml(err.message) + '</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();