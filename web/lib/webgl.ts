let cached: boolean | null = null;

/**
 * Whether this browser can create a WebGL context. Only call it on the
 * client; the result is cached because creating contexts is not free.
 */
export function supportsWebGL(): boolean {
  if (cached !== null) {
    return cached;
  }
  try {
    const canvas = document.createElement("canvas");
    cached = Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    cached = false;
  }
  return cached;
}
