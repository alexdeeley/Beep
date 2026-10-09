// deeley.org: static files, served the way GitHub Pages served them.
//
// Every request goes to the assets store (./dist). A path ending in "/"
// means that folder's index.html, and a path with no extension may be a
// page without ".html" on the end (so /About and /About.html both work,
// and neither one redirects). Anything else is a plain 404.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const tries = [url.pathname];
    if (url.pathname.endsWith('/')) tries.push(url.pathname + 'index.html');
    else if (!/\.[A-Za-z0-9]+$/.test(url.pathname)) tries.push(url.pathname + '.html', url.pathname + '/index.html');
    let res;
    for (const path of tries) {
      const u = new URL(request.url);
      u.pathname = path;
      res = await env.ASSETS.fetch(new Request(u, request));
      if (res.status !== 404) return res;
    }
    return new Response('Not found: ' + url.pathname + '\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
