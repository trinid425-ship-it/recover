export default function Home() {
  return (
    <main style={{ padding: 40, maxWidth: 720 }}>
      <h1 style={{ fontSize: 28 }}>Recover</h1>
      <p style={{ color: "#9aa4b2", lineHeight: 1.6 }}>
        Automated failed-payment churn recovery for Whop communities. This is
        the app surface that renders inside a whop. Open{" "}
        <a href="/dashboard" style={{ color: "#7c9cff" }}>
          /dashboard
        </a>{" "}
        to see recovered revenue.
      </p>
    </main>
  );
}
