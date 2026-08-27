import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://my-window-forest-live.seungmin0807.chatgpt.site',
  ),
  title: 'MY WINDOW — 손끝으로 만드는 나만의 숲',
  description: '빛, 비, 서리, 바람과 번개를 한 창 안에서 손끝으로 만드는 인터랙티브 숲',
  icons: { icon: '/favicon.png' },
  openGraph: {
    title: 'MY WINDOW — 손끝으로 만드는 나만의 숲',
    description: '빛, 비, 서리, 바람과 번개를 한 창 안에서 직접 만져보세요.',
    images: [{ url: '/og.png', width: 1664, height: 936, alt: 'MY WINDOW — 손끝으로 만드는 나만의 숲' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MY WINDOW — 손끝으로 만드는 나만의 숲',
    description: '빛, 비, 서리, 바람과 번개를 한 창 안에서 직접 만져보세요.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
