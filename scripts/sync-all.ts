
import { supabaseAdmin } from "../src/lib/supabase-admin";
import { scoreLandscapeProcurement } from "../src/lib/scoring";

type ProcurementInput = {
  external_id: string;
  source: string;
  title: string;
  description: string;
  location?: string;
  url?: string;
  deadline_at?: string;
  status?: string;
};

async function fetchMockSource(): Promise<ProcurementInput[]> {
  return [
    {
      external_id: "demo-1",
      source: "demo",
      title: "Keskustapuiston perusparannus ja viherrakentaminen",
      description: "Hankinta sisältää puistosuunnittelua, istutuksia ja hulevesiratkaisuja.",
      location: "Espoo",
      url: "https://example.com/hankinta/1",
      deadline_at: "2026-04-29T12:00:00Z",
      status: "Avoin"
    },
    {
      external_id: "demo-2",
      source: "demo",
      title: "Koulupihan maisemasuunnittelu",
      description: "Kohteena koulupiha, leikkiympäristö, istutukset ja turvalliset ulkoalueet.",
      location: "Vantaa",
      url: "https://example.com/hankinta/2",
      deadline_at: "2026-05-03T12:00:00Z",
      status: "Avoin"
    },
    {
      external_id: "demo-3",
      source: "demo",
      title: "IT-laitteiden hankinta",
      description: "Tietokoneita ja oheislaitteita hallinnon käyttöön.",
      location: "Helsinki",
      url: "https://example.com/hankinta/3",
      deadline_at: "2026-05-10T12:00:00Z",
      status: "Avoin"
    }
  ];
}

async function upsertProcurement(item: ProcurementInput) {
  const { data: procurement, error } = await supabaseAdmin
    .from("procurements")
    .upsert(
      {
        external_id: item.external_id,
        source: item.source,
        title: item.title,
        description: item.description,
        location: item.location,
        url: item.url,
        deadline_at: item.deadline_at,
        status: item.status,
        raw_json: item,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "source,external_id"
      }
    )
    .select()
    .single();

  if (error) throw error;

  const score = scoreLandscapeProcurement({
    title: item.title,
    description: item.description
  });

  const { error: scoreError } = await supabaseAdmin
    .from("procurement_scores")
    .upsert(
      {
        procurement_id: procurement.id,
        relevance_score: score.score,
        category: score.category,
        rationale: score.rationale,
        matched_keywords: score.matchedKeywords
      },
      {
        onConflict: "procurement_id"
      }
    );

  if (scoreError) throw scoreError;
}

async function main() {
  const items = await fetchMockSource();

  for (const item of items) {
    await upsertProcurement(item);
  }

  console.log(`Synced ${items.length} procurements`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});