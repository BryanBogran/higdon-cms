/**
 * The firm's logo.
 *
 * ── It is a LIGHT logo ────────────────────────────────────────────────────
 *
 * The artwork is white lettering with a red rule, taken from the firm's own
 * website. That is right for the two dark surfaces it appears on — the top bar
 * and the hamburger drawer — and invisible on a white one, which is why the
 * sign-in page puts it on a dark panel rather than dropping it onto the page.
 *
 * ── Sized well below its native resolution, deliberately ─────────────────
 *
 * The file is 279×61. Rendering it at 110px wide means a 2× display still has
 * more pixels than it needs, so it stays crisp on a retina screen instead of
 * going soft — which is what happens if you display a small PNG at its full
 * width. Width and height are always set so the bar does not reflow as the
 * image loads.
 *
 * Plain <img> rather than next/image: it is a 13 KB static asset served from
 * /public at a fixed size, so there is nothing for the optimiser to do and
 * this avoids a config file to say so.
 */

const NATIVE = { width: 279, height: 61 };

export default function Logo({ width = 110, className = '' }) {
  const height = Math.round((width / NATIVE.width) * NATIVE.height);
  return (
    <img
      src="/logo.png"
      width={width}
      height={height}
      /*
       * The logo IS the firm's name rendered as artwork, so the alt text is
       * that name -- not "logo", which tells a screen reader nothing about
       * whose system this is.
       */
      alt="Higdon Lawyers"
      className={className}
      style={{ width, height }}
    />
  );
}
