import Link from "next/link";
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

type ProcurementRow = {
  id: number;
  title: string;
  ai_summary: string | null;
  description: string | null;
  location: string | null;
  buyer_name: string | null;
  published_at: string | null;
  deadline_at: string | null;
  submission_deadline_text: string | null;
  estimated_value_eur: number | null;
  content_kind: string | null;
  opportunity_signal_score: number | null;
  is_actionable: boolean | null;
};

function cleanLine(text?: string | null) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fi-FI");
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("fi-FI", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function monthLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fi-FI", {
    month: "long",
    year: "numeric",
  });
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

function bestSummary(row: ProcurementRow) {
  return cleanLine(row.ai_summary || row.description || "Ei tiivistelmää saatavilla.");
}

function bestDate(row: ProcurementRow) {
  return row.deadline_at || row.published_at || null;
}

function kindLabel(kind: string | null) {
  if (kind === "live_procurement") return "Avoin hankinta";
  if (kind === "planned_procurement") return "Suunniteltu hankinta";
  if (kind === "decision_document") return "Päätösasiakirja";
  if (kind === "procurement_index_page") return "Indeksisivu";
  if (kind === "multi_item_plan_document") return "Koontidokumentti";
  return "Muu";
}

function priorityColor(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 80) return "linear-gradient(90deg, #22c55e, #86efac)";
  if (s >= 50) return "linear-gradient(90deg, #38bdf8, #818cf8)";
  return "linear-gradient(90deg, #64748b, #cbd5e1)";
}

async function getCalendarRows(): Promise<ProcurementRow[]> {
  const { data, error } = await supabase
    .from("procurements")
    .select(
      "id,title,ai_summary,description,location,buyer_name,published_at,deadline_at,submission_deadline_text,estimated_value_eur,content_kind,opportunity_signal_score,is_actionable"
    )
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(1500);

  if (error) {
    console.error(error);
    return [];
  }

  return ((data as ProcurementRow[]) || []).filter((row) => {
    const hasDate = !!bestDate(row);
    const actionable = !!row.is_actionable;
    const excluded =
      row.content_kind === "decision_document" ||
      row.content_kind === "procurement_index_page" ||
      row.content_kind === "noise";

    return hasDate && actionable && !excluded;
  });
}

export default async function CalendarPage() {
  const rows = await getCalendarRows();

  const grouped = rows.reduce<Record<string, ProcurementRow[]>>((acc, row) => {
    const date = bestDate(row);
    if (!date) return acc;
    const monthKey = date.slice(0, 7);
    if (!acc[monthKey]) acc[monthKey] = [];
    acc[monthKey].push(row);
    return acc;
  }, {});

  const monthKeys = Object.keys(grouped).sort();

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        maxWidth: 1280,
        margin: "0 auto",
        fontFamily: "Arial, sans-serif",
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(circle at top left, rgba(34,211,238,0.16), transparent 25%), radial-gradient(circle at top right, rgba(99,102,241,0.16), transparent 28%), linear-gradient(180deg, #020617, #0f172a 40%, #111827)",
          zIndex: -2,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          zIndex: -1,
          opacity: 0.22,
        }}
      />

      <section style={heroStyle}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Pill>Hankintakalenteri</Pill>
          <Pill background="rgba(34,197,94,0.16)">Aikataulutettu pipeline</Pill>
          <Pill background="rgba(99,102,241,0.16)">Deadline-näkymä</Pill>
        </div>

        <h1 style={heroTitleStyle}>Hankintakalenteri</h1>
        <p style={heroTextStyle}>
          Näe hankinnat kuukausittain ja päivittäin. Kalenteri nostaa näkyviin
          deadline- ja julkaisupäivälliset hankinnat yhdestä näkymästä.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={primaryLinkStyle}>Etusivu</Link>
          <Link href="/search" style={secondaryLinkStyle}>Haku</Link>
          <Link href="/decisions" style={secondaryLinkStyle}>Päätösasiakirjat</Link>
        </div>
      </section>

      {monthKeys.length === 0 ? (
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Ei ajastettuja hankintoja</h2>
          <p style={{ color: "#94a3b8", marginBottom: 0 }}>
            Kalenteriin tulee hankinnat, joilla on julkaisu- tai deadline-päivä.
          </p>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          {monthKeys.map((monthKey) => {
            const monthRows = grouped[monthKey].sort((a, b) => {
              const da = bestDate(a) || "";
              const db = bestDate(b) || "";
              return da.localeCompare(db);
            });

            return (
              <section key={monthKey} style={panelStyle}>
                <div style={{ marginBottom: 18 }}>
                  <h2 style={{ margin: 0, color: "#f8fafc", fontSize: 28 }}>
                    {monthLabel(`${monthKey}-01`)}
                  </h2>
                  <div style={{ color: "#94a3b8", marginTop: 6 }}>
                    {monthRows.length} hankintaa
                  </div>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  {monthRows.map((row) => {
                    const date = bestDate(row)!;
                    const isDeadline = !!row.deadline_at;

                    return (
                      <div
                        key={row.id}
                        style={{
                          ...calendarCardStyle,
                          borderTop: `8px solid transparent`,
                          borderImage: `${priorityColor(row.opportunity_signal_score)} 1`,
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }}>
                          <div
                            style={{
                              border: "1px solid rgba(255,255,255,0.08)",
                              borderRadius: 18,
                              padding: 14,
                              background: "rgba(255,255,255,0.04)",
                              alignSelf: "start",
                            }}
                          >
                            <div style={{ color: "#93c5fd", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              {isDeadline ? "Deadline" : "Julkaistu"}
                            </div>
                            <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                              {dayLabel(date)}
                            </div>
                            <div style={{ color: "#94a3b8", marginTop: 8 }}>
                              {formatDate(date)}
                            </div>
                          </div>

                          <div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <Pill background="rgba(168,85,247,0.16)">
                                Signal {row.opportunity_signal_score ?? 0}
                              </Pill>
                              <Pill>{kindLabel(row.content_kind)}</Pill>
                              {row.submission_deadline_text && (
                                <Pill background="rgba(249,115,22,0.16)">
                                  {row.submission_deadline_text}
                                </Pill>
                              )}
                            </div>

                            <h3
                              style={{
                                marginTop: 0,
                                marginBottom: 8,
                                fontSize: 24,
                                color: "#f8fafc",
                                letterSpacing: "-0.02em",
                              }}
                            >
                              {cleanLine(row.title) || "Hankinta"}
                            </h3>

                            <p style={{ color: "#cbd5e1", lineHeight: 1.6, marginBottom: 14 }}>
                              {bestSummary(row)}
                            </p>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 10,
                                marginBottom: 14,
                              }}
                            >
                              <InfoBox label="Kunta" value={row.location || "-"} />
                              <InfoBox label="Tilaaja" value={row.buyer_name || "-"} />
                              <InfoBox label="Arvo" value={formatMoney(row.estimated_value_eur)} />
                              <InfoBox label="Julkaistu" value={formatDate(row.published_at)} />
                            </div>

                            <Link href={`/procurements/${row.id}`} style={primaryLinkStyle}>
                              Avaa hankinta
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Pill({
  children,
  background = "rgba(255,255,255,0.08)",
}: {
  children: React.ReactNode;
  background?: string;
}) {
  return (
    <span
      style={{
        background,
        color: "#f8fafc",
        padding: "7px 11px",
        borderRadius: 999,
        fontSize: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </span>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoBoxStyle}>
      <div style={infoLabelStyle}>{label}</div>
      <div style={infoValueStyle}>{value}</div>
    </div>
  );
}

const heroStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 32,
  padding: 28,
  marginBottom: 24,
  background:
    "radial-gradient(circle at top right, rgba(34,211,238,0.14), transparent 22%), linear-gradient(180deg, rgba(15,23,42,0.78), rgba(15,23,42,0.48))",
  boxShadow: "0 32px 100px rgba(2,6,23,0.4)",
};

const heroTitleStyle: CSSProperties = {
  fontSize: 42,
  lineHeight: 1.05,
  marginTop: 0,
  marginBottom: 12,
  color: "#f8fafc",
  letterSpacing: "-0.04em",
};

const heroTextStyle: CSSProperties = {
  color: "#cbd5e1",
  maxWidth: 820,
  fontSize: 17,
  lineHeight: 1.65,
  marginBottom: 20,
};

const panelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 28,
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.58), rgba(15,23,42,0.38))",
  padding: 20,
  boxShadow: "0 24px 80px rgba(2,6,23,0.28)",
};

const calendarCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background:
    "radial-gradient(circle at top right, rgba(34,211,238,0.08), transparent 30%), rgba(255,255,255,0.04)",
};

const infoBoxStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 12,
  background: "rgba(255,255,255,0.04)",
};

const infoLabelStyle: CSSProperties = {
  color: "#7dd3fc",
  fontSize: 12,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const infoValueStyle: CSSProperties = {
  color: "#f8fafc",
  fontSize: 14,
  lineHeight: 1.4,
};

const primaryLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderRadius: 16,
  background: "linear-gradient(135deg, #22d3ee, #6366f1)",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 700,
  boxShadow: "0 10px 30px rgba(99,102,241,0.35)",
};

const secondaryLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderRadius: 16,
  background: "rgba(255,255,255,0.06)",
  color: "#e2e8f0",
  textDecoration: "none",
  fontWeight: 700,
  border: "1px solid rgba(255,255,255,0.10)",
};
