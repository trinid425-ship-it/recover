import type { ReactNode } from "react";

export const metadata = {
  title: "Recover — churn recovery for Whop",
  description: "Automatically recover failed-payment churn inside your whop.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
          background: "#0b0d12",
          color: "#e8ebf0",
        }}
      >
        {children}
      </body>
    </html>
  );
}
