(function () {
  'use strict';

  var O = window.ODDS || {};
  var $ = O.$ || function (sel, root) { return (root || document).querySelector(sel); };
  var escapeHtml = O.escapeHtml || function (v) { return String(v == null ? '' : v); };

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; } catch (err) { return ''; }
  }

  function itemHref(item) { return 'item.html?id=' + encodeURIComponent(item.id); }

  function renderError(message) {
    $('#main').innerHTML = '<div class="error-box"><strong>Could not load this item.</strong><br>' + escapeHtml(message) + '<br><br><a href="index.html">&larr; Back to the archive</a></div>';
    $('#sidebar').innerHTML = '';
  }

  function relatedCard(item) {
    var url = O.thumbUrl ? O.thumbUrl(item) : '';
    var thumb = url
      ? '<img loading="lazy" src="' + escapeHtml(url) + '" alt="">'
      : '<span class="thumb-fallback">' + (O.typeIcon ? O.typeIcon(item.type) : '') + '</span>';
    var href = itemHref(item);
    return '' +
      '<article class="card">' +
        '<a class="card-thumb" href="' + escapeHtml(href) + '" aria-label="Open ' + escapeHtml(item.title) + '">' + thumb + '</a>' +
        '<div class="card-body">' +
          '<h3 class="card-title"><a href="' + escapeHtml(href) + '">' + escapeHtml(item.title) + '</a></h3>' +
          '<div class="card-meta">' + escapeHtml(O.typeLabel ? O.typeLabel(item.type) : item.type) + (item.date ? ' &middot; ' + escapeHtml(item.date) : '') + '</div>' +
        '</div>' +
      '</article>';
  }

  function render(item, items) {
    var type = item.type || 'file';
    var href = itemHref(item);
    var tags = (item.tags || []);
    var related = items.filter(function (other) {
      return other.id !== item.id && other.type === type;
    }).slice(0, 6);

    var main = $('#main');
    var html = '';

    html += '<div class="breadcrumbs"><a href="index.html">Home</a> / ' +
      escapeHtml(O.typeLabel ? O.typeLabel(type) : type) + ' / ' + escapeHtml(item.title) + '</div>';

    html += '<div class="detail-head">' +
      '<h1 class="detail-title">' + escapeHtml(item.title) +
        (O.isNew && O.isNew(item) ? '<span class="new-flag">NEW</span>' : '') +
      '</h1>' +
      (item.description ? '<p class="detail-summary">' + escapeHtml(item.description) + '</p>' : '') +
      '<div class="detail-meta">' + escapeHtml(O.typeLabel ? O.typeLabel(type) : type) +
        (item.date ? ' &middot; Added ' + escapeHtml(item.date) : '') + '</div>' +
    '</div>';

    html += '<div id="player-root"></div>';

    if (item.description) {
      html += '<div class="box">' +
        '<div class="box-head">Description</div>' +
        '<div class="box-body"><div class="description">' + escapeHtml(item.description) + '</div></div>' +
      '</div>';
    }

    if (related.length) {
      html += '<div class="section">' +
        '<div class="section-head"><h2 class="section-title">More ' + escapeHtml((O.typeLabel ? O.typeLabel(type) : type) + 's') + '</h2>' +
        '<a class="section-link" href="index.html">See all</a></div>' +
        '<div class="grid">' + related.map(relatedCard).join('') + '</div>' +
      '</div>';
    }

    main.innerHTML = html;

    var playerRoot = $('#player-root');
    if (playerRoot && O.mountPlayer) O.mountPlayer(playerRoot, item);

    // Sidebar
    var sidebar = '' +
      '<div class="box">' +
        '<div class="box-head">Details</div>' +
        '<div class="box-body">' +
          '<dl class="meta-list">' +
            '<dt>Type</dt><dd>' + escapeHtml(O.typeLabel ? O.typeLabel(type) : type) + '</dd>' +
            (item.date ? '<dt>Added</dt><dd>' + escapeHtml(item.date) + '</dd>' : '') +
            '<dt>Item ID</dt><dd class="mono">' + escapeHtml(item.id) + '</dd>' +
          '</dl>' +
        '</div>' +
      '</div>' +
      (tags.length ? '<div class="box"><div class="box-head">Tags</div><div class="box-body">' +
        tags.map(function (t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join(' ') +
      '</div></div>' : '') +
      '<div class="box">' +
        '<div class="box-head">Actions</div>' +
        '<div class="box-body">' +
          '<a class="button" style="width:100%;text-align:center;" href="index.html">&larr; Back to archive</a>' +
        '</div>' +
      '</div>';

    $('#sidebar').innerHTML = sidebar;
  }

  async function init() {
    if (O.initTheme) O.initTheme();

    var id = queryParam('id');
    try {
      var manifest = await O.loadManifest();
      var site = manifest.site || {};
      if (O.applySite) O.applySite(site);
      var items = Array.isArray(manifest.items) ? manifest.items : [];

      var item = items.filter(function (entry) { return String(entry.id) === String(id); })[0];
      if (!item) {
        renderError('Item "' + (id || '(none)') + '" was not found. It may have been removed.');
        return;
      }
      render(item, items);
    } catch (err) {
      renderError(err.message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();