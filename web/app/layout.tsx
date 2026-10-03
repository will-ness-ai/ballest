// No route renders through this yet: every page is a static file in public/ until
// phase 2 of docs/nextjs-migration.md moves the first one into app/.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
