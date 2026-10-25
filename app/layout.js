export const metadata = {
  title: 'Family Tutor',
  description: 'Family Tutor MVP'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
