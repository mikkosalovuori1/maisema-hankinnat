import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fi-FI");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fi-FI");
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("fi-FI", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatConfidence(value: number | null | undefined) {
  if (value == null) return "-";
  return `${Math.round(value * 100)} %`;
}

function contentKindLabel(contentKind: string | null | undefined) {
  if (contentKind === "live_procurement") return "Avoin hankinta";
  if (contentKind === "planned_procurement") return "Suunniteltu hankinta";
  if (contentKind === "multi_item_plan_document") return "Koontidokumentti";
  if (contentKind === "procurement_index_page") return "Indeksisivu";
  if (contentKind === "decision_document") return "Päätösasiakirja";
  if (contentKind === "noise") return "Kohina";
  return "Muu";
}

function cleanLine(text?: string | null) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isBadText(text?: string | null) {
  const t = cleanLine(text).toLowerCase();
  if (!t || t === "-" || t.length < 3) return true;

  return (
    t.startsWith("on kuvattu tarkemmin") ||
    t.startsWith("hankintayksikkö vastaanotti") ||
    t.startsWith("hankintayksikko vastaanotti") ||
    t.startsWith("määräaikaan mennessä") ||
    t.startsWith("maaraaikaan mennessa") ||
    t.startsWith("tekninen lautakunta") ||
    t.startsWith("esityslista") ||
    t.startsWith("pöytäkirja") ||
    t.startsWith("poytakirja") ||
    t.startsWith("asianro") ||
    t.includes("muutoksenhakukirjelmässä") ||
    t.includes("muutoksenhakukirjelmassa") ||
    t.includes("oy malgon ltd")
  );
}

function usableText(text?: string | null) {
  const t = cleanLine(text);
  return !isBadText(t) ? t : null;
}

function bestTitle(procurement: any) {
  return (
    usableText(procurement.title) ||
    usableText(procurement.raw_json?.deterministic_extraction?.procurement_title) ||
    usableText(procurement.raw_json?.ai_extraction?.procurement_title) ||
    "Hankinta"
  );
}

function bestSummary(procurement: any) {
  return (
    usableText(procurement.raw_json?.deterministic_extraction?.procurement_summary) ||
    usableText(procurement.ai_summary) ||
    usableText(procurement.raw_json?.deterministic_extraction?.procurement_description) ||
    usableText(procurement.description) ||
    "Ei tiivistelmää saatavilla."
  );
}

function bestDescription(procurement: any) {
  return (
    usableText(procurement.raw_json?.deterministic_extraction?.procurement_description) ||
    usableText(procurement.description) ||
    usableText(procurement.ai_summary) ||
    "Ei kuvausta saatavilla."
  );
}

function bestReasoningLabels(procurement: any): string[] {
  const fromColumn = Array.isArray(procurement.ai_reasoning_labels)
    ? procurement.ai_reasoning_labels
    : [];
  const fromJson = Array.isArray(procurement.raw_json?.deterministic_extraction?.reasoning_labels)
    ? procurement.raw_json.deterministic_extraction.reasoning_labels
    : [];
  return Array.from(new Set([...fromColumn, ...fromJson])).filter(Boolean);
}

function bestPurchasableItems(procurement: any): string[] {
  const fromColumn = Array.isArray(procurement.purchasable_items)
    ? procurement.purchasable_items
    : [];
  const fromJson = Array.isArray(procurement.raw_json?.deterministic_extraction?.purchasable_items)
    ? procurement.raw_json.deterministic_extraction.purchasable_items
    : [];
  return Array.from(new Set([...fromColumn, ...fromJson]))
    .map((x) => cleanLine(String(x)))
    .filter((x) => x && !isBadText(x));
}

function bestField(obj: any, ...paths: Array<(o: any) => any>) {
  for (const pick of paths) {
    const value = pick(obj);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function extractHighlights(text?: string | null) {
  const lines = (text || "")
    .split(/\n+/)
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .filter((line) => !isBadText(line));

  const preferred = lines.filter((line) => {
    const t = line.toLowerCase();
    return (
      t.includes("puisto") ||
      t.includes("viher") ||
      t.includes("maisema") ||
      t.includes("hulevesi") ||
      t.includes("leikkipuisto") ||
      t.includes("ulkoalue") ||
      t.includes("piha") ||
      t.includes("rakentaminen") ||
      t.includes("urakka") ||
      t.includes("selvitys") ||
      t.includes("kaava") ||
      t.includes("kunnossapito") ||
      t.includes("tarjous") ||
      t.includes("hankinta")
    );
  });

  return (preferred.length > 0 ? preferred : lines).slice(0, 5);
}

function Badge({
  children,
  background = "rgba(255,255,255,0.08)",
  color = "#f8fafc",
  border = "1px solid rgba(255,255,255,0.12)",
}: {
  children: React.ReactNode;
  background?: string;
  color?: string;
  border?: string;
}) {
  return (
    <span
      style={{
        background,
        color,
        border,
        padding: "7px 11px",
        borderRadius: 999,
        fontSize: 12,
        display: "inline-block",
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 28,
  background:
    "radial-gradient(circle at top right, rgba(34,211,238,0.10), transparent 26%), linear-gradient(180deg, rgba(15,23,42,0.90), rgba(17,24,39,0.86))",
  padding: 22,
  boxShadow: "0 28px 90px rgba(2,6,23,0.34)",
  color: "#e2e8f0",
};

const metricBoxStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 12,
  background: "rgba(255,255,255,0.04)",
};

const metricLabelStyle: React.CSSProperties = {
  color: "#7dd3fc",
  fontSize: 12,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const metricValueStyle: React.CSSProperties = {
  color: "#f8fafc",
  fontSize: 14,
  lineHeight: 1.4,
};

const subtleLinkStyle: React.CSSProperties = {
  color: "#93c5fd",
  textDecoration: "none",
};

export default async function ProcurementDetailPage({ params }: PageProps) {
  const { id } = await params;
  const procurementId = Number(id);

  if (!Number.isFinite(procurementId)) notFound();

  const { data: procurement, error } = await supabaseAdmin
    .from("procurements")
    .select("*")
    .eq("id", procurementId)
    .single();

  if (error || !procurement) notFound();

  const [{ data: children }, { data: documents }, { data: parent }, { data: score }] =
    await Promise.all([
      supabaseAdmin
        .from("procurements")
        .select("*")
        .eq("parent_procurement_id", procurementId)
        .order("updated_at", { ascending: false }),

      supabaseAdmin
        .from("source_documents")
        .select("*")
        .eq("procurement_id", procurementId)
        .order("id", { ascending: false }),

      procurement.parent_procurement_id
        ? supabaseAdmin
            .from("procurements")
            .select("id,title,location")
            .eq("id", procurement.parent_procurement_id)
            .single()
        : Promise.resolve({ data: null as any }),

      supabaseAdmin
        .from("procurement_scores")
        .select("*")
        .eq("procurement_id", procurementId)
        .maybeSingle(),
    ]);

  const title = bestTitle(procurement);
  const summary = bestSummary(procurement);
  const description = bestDescription(procurement);
  const reasoningLabels = bestReasoningLabels(procurement);
  const purchasableItems = bestPurchasableItems(procurement);
  const isDecision = procurement.content_kind === "decision_document";

  const buyerName = bestField(
    procurement,
    (o) => o.buyer_name,
    (o) => o.raw_json?.deterministic_extraction?.buyer_name,
    (o) => o.raw_json?.ai_extraction?.buyer_name
  );

  const publishedAt = bestField(
    procurement,
    (o) => o.published_at,
    (o) => o.raw_json?.deterministic_extraction?.published_at,
    (o) => o.raw_json?.ai_extraction?.published_at
  );

  const deadlineAt = bestField(
    procurement,
    (o) => o.deadline_at,
    (o) => o.raw_json?.deterministic_extraction?.deadline_at,
    (o) => o.raw_json?.ai_extraction?.deadline_at
  );

  const submissionDeadlineText = bestField(
    procurement,
    (o) => o.submission_deadline_text,
    (o) => o.raw_json?.deterministic_extraction?.submission_deadline_text,
    (o) => o.raw_json?.ai_extraction?.submission_deadline_text
  );

  const estimatedValueEur = bestField(
    procurement,
    (o) => o.estimated_value_eur,
    (o) => o.raw_json?.deterministic_extraction?.estimated_value_eur,
    (o) => o.raw_json?.ai_extraction?.estimated_value_eur
  );

  const cpvText = bestField(
    procurement,
    (o) => o.cpv_text,
    (o) => o.raw_json?.deterministic_extraction?.cpv,
    (o) => o.raw_json?.ai_extraction?.cpv
  );

  const locationText = bestField(
    procurement,
    (o) => o.location,
    (o) => o.raw_json?.deterministic_extraction?.location_text,
    (o) => o.raw_json?.ai_extraction?.location_text
  );

  return (
    <main
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Arial, sans-serif",
        minHeight: "100vh",
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "radial-gradient(circle at top left, rgba(34,211,238,0.14), transparent 24%), radial-gradient(circle at top right, rgba(99,102,241,0.14), transparent 26%), linear-gradient(180deg, #020617, #0f172a 42%, #111827)",
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

      <div style={{ marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/" style={subtleLinkStyle}>Etusivu</Link>
        <Link href="/search" style={subtleLinkStyle}>Haku</Link>
        <Link href="/decisions" style={subtleLinkStyle}>Päätösasiakirjat</Link>
        {parent && (
          <Link href={`/procurements/${parent.id}`} style={subtleLinkStyle}>
            Avaa emohankinta
          </Link>
        )}
      </div>

      <div style={{ ...cardStyle, marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <Badge>{contentKindLabel(procurement.content_kind)}</Badge>
          {procurement.is_split_item ? (
            <Badge background="rgba(250,204,21,0.16)">Osahankinta</Badge>
          ) : (
            <Badge background="rgba(34,197,94,0.16)">Päähankinta</Badge>
          )}
          <Badge background="rgba(168,85,247,0.16)">
            Signal {procurement.opportunity_signal_score ?? 0}
          </Badge>
          {score?.relevance_score != null && (
            <Badge background="rgba(59,130,246,0.16)">Score {score.relevance_score}</Badge>
          )}
          <Badge background="rgba(249,115,22,0.16)">
            Varmuus {formatConfidence(procurement.ai_confidence)}
          </Badge>
          {isDecision && (
            <Badge background="rgba(239,68,68,0.16)">Päätösasiakirja</Badge>
          )}
        </div>

        <h1
          style={{
            fontSize: 36,
            marginTop: 0,
            marginBottom: 12,
            color: "#f8fafc",
            letterSpacing: "-0.03em",
          }}
        >
          {title}
        </h1>

        <p style={{ color: "#cbd5e1", fontSize: 17, lineHeight: 1.7, marginBottom: 16 }}>
          {summary}
        </p>

        {reasoningLabels.length > 0 && (
          <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {reasoningLabels.map((label, index) => (
              <Badge key={`${label}-${index}`} background="rgba(14,165,233,0.14)">
                {label}
              </Badge>
            ))}
          </div>
        )}

        {purchasableItems.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 10, color: "#93c5fd" }}>Hankittava asia</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {purchasableItems.map((item, index) => (
                <Badge key={`${item}-${index}`} background="rgba(34,197,94,0.14)">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Kunta</div>
            <div style={metricValueStyle}>{locationText || "-"}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Tilaaja</div>
            <div style={metricValueStyle}>{buyerName || "-"}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Arvo</div>
            <div style={metricValueStyle}>{formatMoney(estimatedValueEur)}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Julkaistu</div>
            <div style={metricValueStyle}>{formatDate(publishedAt)}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Deadline</div>
            <div style={metricValueStyle}>{formatDate(deadlineAt)}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Tarjouksen jättöaika</div>
            <div style={metricValueStyle}>{submissionDeadlineText || "-"}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>CPV</div>
            <div style={metricValueStyle}>{cpvText || "-"}</div>
          </div>
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Päivitetty</div>
            <div style={metricValueStyle}>{formatDateTime(procurement.updated_at)}</div>
          </div>
        </div>

        {(procurement.url || procurement.original_source_url) && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 10, color: "#93c5fd" }}>Alkuperäiset linkit</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {procurement.original_source_url && (
                <a href={procurement.original_source_url} target="_blank" rel="noreferrer" style={subtleLinkStyle}>
                  Avaa alkuperäinen hankintalinkki
                </a>
              )}
              {procurement.url && procurement.url !== procurement.original_source_url && (
                <a href={procurement.url} target="_blank" rel="noreferrer" style={subtleLinkStyle}>
                  Avaa lähdeosoite
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, marginBottom: 22 }}>
        <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Tiivistelmä</h2>
        <p style={{ color: "#cbd5e1", lineHeight: 1.7, marginBottom: 0 }}>{summary}</p>
      </div>

      <div style={{ ...cardStyle, marginBottom: 22 }}>
        <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Kuvaus</h2>
        <p style={{ color: "#cbd5e1", lineHeight: 1.7, marginBottom: 0 }}>{description}</p>
      </div>

      <div style={{ ...cardStyle, marginBottom: 22 }}>
        <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Dokumentista pilkotut osahankinnat</h2>

        {!children || children.length === 0 ? (
          <p style={{ color: "#94a3b8", marginBottom: 0 }}>
            Tästä hankinnasta ei löytynyt erikseen pilkottuja osahankintoja.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {children.map((child: any) => {
              const childTitle = bestTitle(child);
              const childSummary = bestSummary(child);
              const childItems = bestPurchasableItems(child);

              return (
                <div
                  key={child.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 22,
                    padding: 18,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <Badge background="rgba(250,204,21,0.16)">Osahankinta</Badge>
                    <Badge>{contentKindLabel(child.content_kind)}</Badge>
                    <Badge background="rgba(249,115,22,0.16)">
                      Varmuus {formatConfidence(child.ai_confidence)}
                    </Badge>
                  </div>

                  <h3 style={{ marginTop: 0, marginBottom: 10, color: "#f8fafc", fontSize: 22 }}>
                    <Link href={`/procurements/${child.id}`} style={subtleLinkStyle}>
                      {childTitle}
                    </Link>
                  </h3>

                  <p style={{ color: "#cbd5e1", marginBottom: 14 }}>{childSummary}</p>

                  {childItems.length > 0 && (
                    <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {childItems.map((item: string, index: number) => (
                        <Badge key={`${item}-${index}`} background="rgba(34,197,94,0.14)">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>Tilaaja</div>
                      <div style={metricValueStyle}>{child.buyer_name || "-"}</div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>Arvo</div>
                      <div style={metricValueStyle}>{formatMoney(child.estimated_value_eur)}</div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>Julkaistu</div>
                      <div style={metricValueStyle}>{formatDate(child.published_at)}</div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>Deadline</div>
                      <div style={metricValueStyle}>{formatDate(child.deadline_at)}</div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>Tarjouksen jättöaika</div>
                      <div style={metricValueStyle}>{child.submission_deadline_text || "-"}</div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={metricLabelStyle}>CPV</div>
                      <div style={metricValueStyle}>{child.cpv_text || "-"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, color: "#f8fafc" }}>Liitetiedostot</h2>

        {!documents || documents.length === 0 ? (
          <p style={{ color: "#94a3b8", marginBottom: 0 }}>Ei liitetiedostoja.</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {documents.map((doc: any) => {
              const extracted = doc.extracted_fields || {};
              const highlights = extractHighlights(doc.extracted_text);

              return (
                <div
                  key={doc.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 22,
                    padding: 18,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: 10, color: "#f8fafc" }}>
                    {doc.filename || "Liitetiedosto"}
                  </h3>

                  <div style={{ marginBottom: 10 }}>
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noreferrer" style={subtleLinkStyle}>
                        Avaa liitetiedosto
                      </a>
                    )}
                  </div>

                  <div style={{ marginBottom: 14, color: "#cbd5e1" }}>
                    <strong>Tiedostotyyppi:</strong> {doc.content_type || "-"}
                  </div>

                  <div style={{ display: "grid", gap: 6, marginBottom: 14, color: "#e2e8f0" }}>
                    <div><strong>Otsikko:</strong> {usableText(extracted.title) || "-"}</div>
                    <div><strong>Tilaaja:</strong> {usableText(extracted.buyerName) || "-"}</div>
                    <div><strong>Julkaistu:</strong> {usableText(extracted.publishedAt) || "-"}</div>
                    <div><strong>Deadline:</strong> {usableText(extracted.deadlineAt) || "-"}</div>
                    <div><strong>Tarjouksen jättöaika:</strong> {usableText(extracted.submissionDeadlineText) || "-"}</div>
                    <div><strong>Sijainti:</strong> {usableText(extracted.locationText) || "-"}</div>
                    <div><strong>CPV:</strong> {usableText(extracted.cpvText) || "-"}</div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "#93c5fd" }}>Parhaat poiminnat:</strong>
                    {highlights.length > 0 ? (
                      <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                        {highlights.map((line, index) => (
                          <li key={index} style={{ marginBottom: 6, color: "#cbd5e1" }}>
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ color: "#94a3b8", marginTop: 8, marginBottom: 0 }}>
                        Ei poimintoja saatavilla.
                      </p>
                    )}
                  </div>

                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", color: "#93c5fd" }}>
                      Näytä raakateksti
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 16,
                        padding: 12,
                        marginTop: 12,
                        fontSize: 13,
                        color: "#cbd5e1",
                      }}
                    >
                      {doc.extracted_text || "Ei raakatekstiä saatavilla."}
                    </pre>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
