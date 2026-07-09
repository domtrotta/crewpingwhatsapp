import type { ReactNode } from 'react';

export const metadata = {
  title: 'WhatsApp Bot API',
  description: 'Backend for the WhatsApp crew booking bot',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
