/** Subtle, slow-drifting gradient blobs behind all content. Pure CSS
 * (no JS animation loop, no canvas) so it costs nothing at runtime beyond a
 * GPU-composited transform, and is fully disabled under prefers-reduced-motion
 * (see globals.css). Purely decorative -- hidden from assistive tech. */
export function AmbientBackground() {
  return (
    <div className="ambient-background" aria-hidden="true">
      <div className="ambient-blob ambient-blob-1" />
      <div className="ambient-blob ambient-blob-2" />
    </div>
  );
}
