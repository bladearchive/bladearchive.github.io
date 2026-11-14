/**
 * Blade Archive - Drive download proxy (Cloudflare Worker).
 *
 * Why this exists:
 *   - Browsers block cross-site fetch() to drive.usercontent.google.com
 *     (Sec-Fetch-Site), so the site cannot read Drive bytes directly.
 *   - The Drive API alt=media endpoint is rate-limited ("automated queries")
 *     on some networks.
 *   - This worker fetches the file server-side and returns it with CORS
 *     headers, so the site can play Drive video/audio and render HTML games.
 *
 * Deploy:
 *   1. Cloudflare Dashboard -> Workers & Pages -> Create -> Worker.
 *   2. Paste this file as the worker code, then Deploy.
 *   3. Copy the worker URL, e.g. https://blade-proxy.<subdomain>.workers.dev/
 *   4. In the site's assets/config.js set:
 *        driveProxyUrl: 'https://blade-proxy.<subdomain>.workers.dev/'
 *   5. Redeploy the site.
 *
 * The site calls: <driveProxyUrl>?id=<fileId>
 */
export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length,Content-Type,Content-Range,Accept-Ranges',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response('Missing ?id=<drive file id>', { status: 400, headers: cors });
    }

    const upstreamUrl =
      'https://drive.usercontent.google.com/download?id=' +
      encodeURIComponent(id) +
      '&export=download';

    let upstream;
    try {
      upstream = await fetch(upstreamUrl);
    } catch (err) {
      return new Response('Upstream fetch failed: ' + err.message, { status: 502, headers: cors });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response('Drive error ' + upstream.status, { status: upstream.status, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
    const len = upstream.headers.get('Content-Length');
    if (len) headers.set('Content-Length', len);
    const range = upstream.headers.get('Content-Range');
    if (range) headers.set('Content-Range', range);
    const acceptRanges = upstream.headers.get('Accept-Ranges');
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};