export function createRouter() {
  const routes = [];

  function addRoute(methodName, pattern, handler) {
    const paramNames = [];
    // Escape regex special chars except ':' which we use for params
    const escaped = pattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }) + '$';

    routes.push({
      method: methodName.toUpperCase(),
      regex: new RegExp(regexStr),
      paramNames,
      handler,
    });
  }

  return {
    get(pattern, handler) { addRoute('GET', pattern, handler); },
    post(pattern, handler) { addRoute('POST', pattern, handler); },
    put(pattern, handler) { addRoute('PUT', pattern, handler); },
    delete(pattern, handler) { addRoute('DELETE', pattern, handler); },

    /** @returns {boolean} true if a route matched and handled the request */
    match(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      const searchParams = url.searchParams;

      for (const route of routes) {
        if (route.method !== req.method) continue;

        const m = pathname.match(route.regex);
        if (!m) continue;

        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = m[i + 1];
        });

        route.handler(req, res, { params, searchParams, pathname });
        return true;
      }

      return false;
    },
  };
}
