"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// The no-flash script must run on the server-rendered HTML only; on the client React would warn about
// rendering a <script>, so it's inert there (see Next's "Preventing flash before hydration" guide).
const scriptProps = { type: typeof window === "undefined" ? "text/javascript" : "text/plain" };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={scriptProps}
    >
      {children}
    </NextThemesProvider>
  );
}
