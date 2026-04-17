type ScoreResult = {
  score: number;
  matchedKeywords: string[];
  category: string;
  rationale: string;
};

const positiveKeywords = [
  "puisto",
  "viherrakentaminen",
  "viheralue",
  "maisemasuunnittelu",
  "pihasuunnittelu",
  "koulupiha",
  "leikkipuisto",
  "aukio",
  "katuvihreä",
  "hulevesi",
  "ympäristörakentaminen",
  "virkistysalue",
  "reitistö",
  "rantareitti",
  "istutukset",
  "kaupunkitila",
  "ulkoalueet"
];

const negativeKeywords = [
  "it-järjestelmä",
  "ohjelmistolisenssi",
  "ajoneuvo",
  "lääkintälaite",
  "toimistokaluste",
  "sisätilasuunnittelu"
];

export function scoreLandscapeProcurement(input: {
  title?: string;
  description?: string;
}): ScoreResult {
  const text = `${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();

  let score = 0;
  const matchedKeywords: string[] = [];

  for (const keyword of positiveKeywords) {
    if (text.includes(keyword)) {
      score += 15;
      matchedKeywords.push(keyword);
    }
  }

  for (const keyword of negativeKeywords) {
    if (text.includes(keyword)) {
      score -= 30;
    }
  }

  if (text.includes("puisto") || text.includes("maisemasuunnittelu")) {
    score += 20;
  }

  const category =
    text.includes("koulupiha") ? "Piha" :
    text.includes("puisto") ? "Puisto" :
    text.includes("hulevesi") ? "Hulevesi" :
    text.includes("reitistö") ? "Virkistys" :
    "Muu ulkotila";

  return {
    score: Math.max(0, Math.min(score, 100)),
    matchedKeywords,
    category,
    rationale: matchedKeywords.length
      ? `Osuma avainsanoihin: ${matchedKeywords.join(", ")}`
      : "Ei vahvoja maisema-arkkitehtuurin signaaleja"
  };
}