const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

export function allowedOrigins(appUrl: URL, production: boolean): Set<string> {
  const origins = new Set([appUrl.origin]);
  if (!production && loopbackHosts.includes(appUrl.hostname)) {
    for (const hostname of loopbackHosts) {
      const alias = new URL(appUrl.origin);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }
  return origins;
}
