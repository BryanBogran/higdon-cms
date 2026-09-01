import { IBM_Plex_Sans, Inter } from 'next/font/google';
import './globals.css';
import { DataProvider } from '@/lib/data/DataProvider';
import TopRail from '@/components/shell/TopRail';
import { cookies } from 'next/headers';
import { THEME_KEY, normalizePreference, themeAttr } from '@/lib/theme';

const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'Higdon Lawyers — Case Management',
  description: 'Case management for Higdon Lawyers.',
};

export default async function RootLayout({ children }) {
  /*
   * The theme comes from a cookie so it can be applied HERE, on the server,
   * rather than by a script after the HTML has already started painting.
   *
   * A pre-paint script cannot work here. This app already has a hydration
   * mismatch on every route -- it predates dark mode entirely; revert this file
   * to its previous version and the same error still appears -- and React
   * responds by discarding the server HTML and re-rendering the whole tree on
   * the client. That rebuilds <html>'s className, so a `dark` class put there
   * by a script is silently wiped. Rendering the script inside the component
   * only made it worse: React 19 rejects a <script> in the tree outright.
   *
   * `data-theme` from a cookie sidesteps both. React renders the attribute
   * itself, so a re-render reproduces it rather than dropping it.
   *
   * `themeAttr` returns undefined for "System", which is the default. React
   * omits an undefined attribute, and globals.css then resolves it with
   * `prefers-color-scheme` -- so the common case needs no cookie and no JS.
   *
   * This makes the layout dynamically rendered. That costs nothing real here:
   * every route is behind auth and already passes through middleware that
   * reads cookies, and all page data is fetched client-side.
   */
  const preference = normalizePreference((await cookies()).get(THEME_KEY)?.value);

  return (
    <html
      lang="en"
      className={`${plex.variable} ${inter.variable}`}
      data-theme={themeAttr(preference)}
    >
      <body className="bg-canvas text-ink antialiased">
        <DataProvider>
          <TopRail />
          {children}
        </DataProvider>
      </body>
    </html>
  );
}
