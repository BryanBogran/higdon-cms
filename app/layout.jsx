import { IBM_Plex_Sans, Inter } from 'next/font/google';
import './globals.css';
import { DataProvider } from '@/lib/data/DataProvider';
import TopRail from '@/components/shell/TopRail';

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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${inter.variable}`}>
      <body className="bg-slate-50 text-slate-900 antialiased">
        <DataProvider>
          <TopRail />
          {children}
        </DataProvider>
      </body>
    </html>
  );
}
