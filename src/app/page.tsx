export default function Home() {
  return (
    <main
      style={{
        minHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 40,
        gap: 4,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/recover-icon.png" alt="Recover" width={128} height={128} />
      <h1 style={{ fontSize: 30, margin: "12px 0 0" }}>Recover</h1>
      <p style={{ color: "#9aa4b2", lineHeight: 1.6, maxWidth: 460 }}>
        Turn failed payments into recovered revenue — automatically. Wins back
        members who fail or cancel, and flags risks before they cost you.
      </p>
      <a
        href="/dashboard"
        style={{
          marginTop: 14,
          color: "#e8ebf0",
          background: "#1a7f5a",
          textDecoration: "none",
          padding: "10px 20px",
          borderRadius: 10,
          fontWeight: 500,
        }}
      >
        Open dashboard
      </a>
    </main>
  );
}
