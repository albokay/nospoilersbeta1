import React from "react";

export default function Tabs({ tabs, value, onChange }: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--dos-border)", marginLeft: 12 }}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          className="btn"
          onClick={() => onChange(t.id)}
          style={{
            border: "none",
            borderRight: i < tabs.length - 1 ? "1px solid var(--dos-border)" : "none",
            background: value === t.id ? "var(--dos-blue)" : "transparent",
            color: value === t.id ? "#fff" : "var(--dos-fg)",
            borderRadius: 0
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
