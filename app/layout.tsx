
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body style={{ fontFamily: "Arial", padding: 20 }}>
        {children}
      </body>
    </html>
  );
}
