export const dynamic = "force-static";

export default function LegacyPage() {
  return (
    <div style={{ height: "100dvh", width: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgba(0,0,0,.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700 }}>GUFO • Modul vechi (index.html)</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a href="/legacy/index.html" target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            Deschide în tab nou
          </a>
        </div>
      </div>

      <iframe
        title="GUFO Legacy"
        src="/legacy/index.html"
        style={{ flex: 1, width: "100%", border: 0 }}
      />
    </div>
  );
}
