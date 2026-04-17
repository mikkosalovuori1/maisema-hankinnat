import { supabase } from "@/lib/supabase";

type ScoreRow = {
  procurement_id: number;
  relevance_score: number;
  category: string | null;
  rationale: string | null;
};

type ProcurementRow = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  deadline_at: string | null;
  status: string | null;
  url: string | null;
};

async function getProcurements() {
  const { data: procurements, error: procurementsError } = await supabase
    .from("procurements")
    .select("id, title, description, location, deadline_at, status, url")
    .order("deadline_at", { ascending: true });

  const { data: scores, error: scoresError } = await supabase
    .from("procurement_scores")
    .select("procurement_id, relevance_score, category, rationale");

  if (procurementsError) {
    console.error("Procurements error:", procurementsError);
    return [];
  }

  if (scoresError) {
    console.error("Scores error:", scoresError);
    return [];
  }

  const scoreMap = new Map<number, ScoreRow>();
  for (const score of (scores as ScoreRow[]) ?? []) {
    scoreMap.set(score.procurement_id, score);
  }

  return ((procurements as ProcurementRow[]) ?? []).map((item) => ({
    ...item,
    score: scoreMap.get(item.id) ?? null,
  }));
}

function formatDate(date: string | null) {
  if (!date) return "Ei määräaikaa";
  return new Date(date).toLocaleDateString("fi-FI");
}

export default async function HomePage() {
  const rows = await getProcurements();

  const filtered = rows.filter((item) => {
    const score = item.score?.relevance_score ?? 0;
    return score >= 40;
  });

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Maisema-arkkitehdin hankintavahti</h1>
      <p style={{ color: "#555", marginBottom: 32 }}>
        Julkiset hankinnat suodatettuna maisema-arkkitehdin näkökulmasta.
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {filtered.map((item) => {
          const score = item.score?.relevance_score ?? 0;
          const category = item.score?.category ?? "Muu";
          const rationale = item.score?.rationale ?? "";

          return (
            <div
              key={item.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 16,
                padding: 20,
                background: "white"
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ background: "#e8f5e9", padding: "6px 10px", borderRadius: 999 }}>
                  {category}
                </span>
                <span style={{ background: "#eef2ff", padding: "6px 10px", borderRadius: 999 }}>
                  Score {score}/100
                </span>
                <span style={{ background: "#f5f5f5", padding: "6px 10px", borderRadius: 999 }}>
                  {item.status ?? "Tuntematon"}
                </span>
              </div>

              <h2 style={{ fontSize: 24, marginBottom: 10 }}>{item.title}</h2>

              <p style={{ color: "#555", marginBottom: 12 }}>
                {item.description ?? "Ei kuvausta"}
              </p>

              <div style={{ fontSize: 14, color: "#444", marginBottom: 8 }}>
                <strong>Sijainti:</strong> {item.location ?? "Ei tiedossa"}
              </div>

              <div style={{ fontSize: 14, color: "#444", marginBottom: 8 }}>
                <strong>Määräaika:</strong> {formatDate(item.deadline_at)}
              </div>

              <div style={{ fontSize: 14, color: "#444", marginBottom: 12 }}>
                <strong>Perustelu:</strong> {rationale}
              </div>

              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  Avaa hankinta
                </a>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div>Ei vielä näkyviä maisema-arkkitehdille relevantteja hankintoja.</div>
        )}
      </div>
    </main>
  );
}