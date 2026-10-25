/** Invite links for LAN PvP: https://<host-lan-ip>:<port>/?room=CODE */

const ROOM_PARAM = 'room';
const ROOM_CODE = /^[A-Za-z0-9_-]{1,16}$/; // mirrors the server's roomId validation

export function readInviteRoom(): string | null {
  const code = new URLSearchParams(window.location.search).get(ROOM_PARAM)?.trim();
  return code && ROOM_CODE.test(code) ? code.toUpperCase() : null;
}

/** Drop ?room= after joining so a refresh resumes via the saved session instead of re-joining. */
export function clearInviteFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(ROOM_PARAM)) return;
  url.searchParams.delete(ROOM_PARAM);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The guest must reach the host by its LAN address. If the host opened the game
 * via localhost, ask the server which LAN address to advertise.
 */
export async function buildInviteLink(roomId: string): Promise<string> {
  let origin = window.location.origin;
  if (isLoopback(window.location.hostname)) {
    try {
      const res = await fetch('/lan-info', { cache: 'no-store' });
      const info = (await res.json()) as { protocol: string; port: number; addresses: string[] };
      if (info.addresses[0]) origin = `${info.protocol}://${info.addresses[0]}:${info.port}`;
    } catch {
      // Dev server without /lan-info: fall back to the current origin.
    }
  }
  return `${origin}/?${ROOM_PARAM}=${encodeURIComponent(roomId)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is unavailable on insecure origins; fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
