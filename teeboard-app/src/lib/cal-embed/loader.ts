/**
 * Cal.com embed loader implementing the documented embed protocol:
 * `window.Cal` must exist before embed.js loads; commands issued before the
 * script is ready are queued on `Cal.q`, and embed.js drains the queue (and
 * replaces `q.push` with its own dispatcher) once it has loaded.
 */
export const CAL_EMBED_SCRIPT_URL = "https://app.cal.com/embed/embed.js";

type CalGlobal = ((...args: unknown[]) => void) & {
  q?: unknown[][];
  ns?: Record<string, unknown>;
  loaded?: boolean;
};

declare global {
  interface Window {
    Cal?: CalGlobal;
  }
}

export function loadCalEmbed(
  scriptUrl: string = CAL_EMBED_SCRIPT_URL,
): CalGlobal {
  if (typeof window === "undefined") {
    throw new Error("The Cal.com embed loader can only run in the browser.");
  }

  const existing = window.Cal;
  if (existing) return existing;

  const Cal = ((...args: unknown[]) => {
    const cal = window.Cal;
    if (!cal) return;

    if (!cal.loaded) {
      const script = document.createElement("script");
      script.src = scriptUrl;
      document.head.appendChild(script);
      cal.ns = cal.ns ?? {};
      cal.q = cal.q ?? [];
      cal.loaded = true;
    }

    cal.q?.push(args);
  }) as CalGlobal;

  Cal.q = [];
  Cal.ns = {};
  Cal.loaded = false;
  window.Cal = Cal;
  return Cal;
}

export type { CalGlobal };
