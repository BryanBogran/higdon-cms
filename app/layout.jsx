import { IBM_Plex_Sans, Inter } from "next/font/google";
import "./globals.css";

/*
 * The prototype sets fontFamily: "'IBM Plex Sans','Inter',system-ui,sans-serif"
 * inline at higdon-cms.jsx:167 but never loads either face -- it relied on the
 * host page having them. Load them properly and expose the stack as a CSS
 * variable so the inline style resolves to a font that actually exists.
 */
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "Higdon Lawyers — Case Management",
  description: "Case management for Higdon Lawyers.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
