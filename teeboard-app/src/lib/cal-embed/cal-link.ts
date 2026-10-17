const CAL_HOST_PATTERN = /^(?:www\.|app\.)?cal\.com$/i;

/**
 * Normalizes a Cal.com event-type link to the path form the embed expects
 * (`username/event-type`). Accepts a full Cal.com URL (with or without
 * scheme/host), or an already-relative path; returns null when the value
 * cannot be used so the caller can hide the booking section instead of
 * rendering a broken embed. Links on hosts other than cal.com are rejected
 * because the embed loads from the Cal.com SaaS origin.
 */
export function toCalLink(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let pathname: string;
  try {
    const url = new URL(trimmed, "https://cal.com");
    if (
      /^https?:$/.test(url.protocol) &&
      !CAL_HOST_PATTERN.test(url.hostname)
    ) {
      return null;
    }
    pathname = url.pathname;
  } catch {
    return null;
  }

  const path = pathname
    .replace(/^\/+/, "")
    .replace(/^(?:www\.|app\.)?cal\.com\//i, "")
    .replace(/\/+$/, "");

  if (!path || path.includes("//") || path.includes(" ")) return null;

  return path;
}
