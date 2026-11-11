// Finding the quick tunnel's address in what `cloudflared` prints.

/**
 * A quick tunnel's name is a few lower-case words joined by hyphens, directly under trycloudflare.com. This
 * does not match `api.trycloudflare.com` (the API cloudflared calls, which shows up in its error lines),
 * `www`, deeper subdomains, or a longer host that merely starts the same way.
 */
const TUNNEL_URL = /(?<![A-Za-z0-9.+_-])https:\/\/([a-z0-9]+(?:-[a-z0-9]+)+)\.trycloudflare\.com(?![A-Za-z0-9._-])/;

/** The tunnel's public address in `text`, or null. */
export function tunnelUrl(text) {
  const m = TUNNEL_URL.exec(text);
  return m ? `https://${m[1]}.trycloudflare.com` : null;
}
