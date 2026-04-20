type Input = {
  municipalityName: string | null;
  sourceName: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
  documentText: string;
  contentType?: string | null;
  filename?: string | null;
};

export type DeterministicExtractionResult = {
  procurement_title: string;
  procurement_description: string;
  procurement_summary: string;
  purchasable_items: string[];
  estimated_value_eur: number | null;
  published_at: string | null;
  deadline_at: string | null;
  submission_deadline_text: string | null;
  buyer_name: string | null;
  location_text: string | null;
  cpv: string | null;
  confidence: number;
  priority_score: number;
  reasoning_labels: string[];
  document_kind:
    | "live_procurement"
    | "planned_procurement"
    | "decision_document"
    | "comparison_document"
    | "index_page"
    | "unknown";
  title_quality_score: number;
  content_quality_score: number;
  reject_reason: string | null;
};

function cleanText(input?: string | null) {
  return (input || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]+/g, " ")
    .trim();
}

function cleanLine(input?: string | null) {
  return cleanText(input).replace(/\s+/g, " ").trim();
}

function linesOf(text: string) {
  return cleanText(text)
    .split(/\n+/)
    .map((line) => cleanLine(line))
    .filter(Boolean);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function parseFinnishDate(dateText: string): string | null {
  const match = dateText.match(
    /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*klo\s*(\d{1,2})[:.](\d{2}))?/i
  );
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3];
  const hour = (match[4] || "00").padStart(2, "0");
  const minute = (match[5] || "00").padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

function parseFinnishMoney(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/€/g, "")
    .replace(/euroa?/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(/,(?=\d{2}\b)/g, ".");

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function detectFileType(contentType?: string | null, filename?: string | null) {
  const ct = (contentType || "").toLowerCase();
  const fn = (filename || "").toLowerCase();

  if (ct.includes("pdf") || fn.endsWith(".pdf")) return "pdf";
  if (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    fn.endsWith(".xlsx") ||
    fn.endsWith(".xls")
  ) {
    return "spreadsheet";
  }
  if (ct.includes("csv") || fn.endsWith(".csv")) return "csv";
  if (ct.includes("word") || fn.endsWith(".docx") || fn.endsWith(".doc")) return "word";
  if (
    ct.startsWith("image/") ||
    fn.endsWith(".jpg") ||
    fn.endsWith(".jpeg") ||
    fn.endsWith(".png") ||
    fn.endsWith(".webp")
  ) {
    return "image";
  }
  return "generic";
}

function hasProcurementKeyword(text?: string | null) {
  const t = (text || "").toLowerCase();

  return (
    t.includes("puisto") ||
    t.includes("viher") ||
    t.includes("viherrakent") ||
    t.includes("maisema") ||
    t.includes("hulevesi") ||
    t.includes("leikkipuisto") ||
    t.includes("ulkoalue") ||
    t.includes("piha") ||
    t.includes("istutus") ||
    t.includes("ympäristörakent") ||
    t.includes("ymparistorakent") ||
    t.includes("katuympäristö") ||
    t.includes("katuymparisto") ||
    t.includes("maanrakenn") ||
    t.includes("kunnossapito") ||
    t.includes("osayleiskaava") ||
    t.includes("asemakaava") ||
    t.includes("kaava") ||
    t.includes("selvitys") ||
    t.includes("urakka") ||
    t.includes("rakentaminen") ||
    t.includes("palvelu") ||
    t.includes("hankinta") ||
    t.includes("kiviainekset")
  );
}

function isBadAdministrativeLine(line: string) {
  const t = line.toLowerCase();

  return (
    !t ||
    t.length < 4 ||
    t === "-" ||
    t === "muuta" ||
    t === "tuoteryhmä" ||
    t === "valmistelu" ||
    t === "nykyinen sopimus" ||
    t === "nykyisen sopimuksen voimassaolo" ||
    t === "nykyinen sopimustoimittaja" ||
    t === "cpv" ||
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
    t.includes("tarjoukset vastaanotettiin") ||
    t.includes("muutoksenhakukirjelmässä") ||
    t.includes("muutoksenhakukirjelmassa") ||
    t.includes("oy malgon ltd") ||
    t.includes("hankinnat ja tarjouspyynnöt") ||
    t.includes("avoimia tarjouspyyntöjä julkaistaan")
  );
}

function isDecisionDocument(text: string) {
  const t = text.toLowerCase();
  let score = 0;

  if (t.includes("esityslista")) score += 2;
  if (t.includes("pöytäkirja") || t.includes("poytakirja")) score += 2;
  if (t.includes("lautakunta")) score += 2;
  if (t.includes("hankintapäätös") || t.includes("hankintapaatos")) score += 2;
  if (t.includes("viranhaltijapäätös") || t.includes("viranhaltijapaatos")) score += 2;
  if (t.includes("tarjoukset vastaanotettiin")) score += 2;
  if (t.includes("määräaikaan mennessä") || t.includes("maaraaikaan mennessa")) score += 2;
  if (t.includes("asianro")) score += 1;
  if (t.includes("muutoksenhaku")) score += 1;
  if (t.includes("hankintaoikaisu")) score += 1;

  return score >= 3;
}

function isComparisonDocument(text: string) {
  const t = text.toLowerCase();
  return t.includes("tarjousvertailu") || (t.includes("vertailu") && t.includes("tarjous"));
}

function isIndexPage(text: string) {
  const t = text.toLowerCase();
  let score = 0;
  if (t.includes("hankinnat ja tarjouspyynnöt")) score += 2;
  if (t.includes("avoimia tarjouspyyntöjä julkaistaan")) score += 2;
  if (t.includes("cloudia")) score += 1;
  if (t.includes("hilma")) score += 1;
  return score >= 3;
}

function isPlannedProcurement(text: string) {
  const t = text.toLowerCase();
  let score = 0;
  if (t.includes("suunnitellut hankinnat")) score += 2;
  if (t.includes("kilpailutettavat hankinnat")) score += 2;
  if (t.includes("hankintasuunnitelma")) score += 2;
  if (t.includes("vuonna 2026")) score += 1;
  if (t.includes("vuonna 2027")) score += 1;
  if (t.includes("vuonna 2028")) score += 1;
  if (t.includes("valmistelu")) score += 1;
  return score >= 3;
}

function isLiveProcurement(text: string) {
  const t = text.toLowerCase();
  let score = 0;
  if (t.includes("tarjouspyyntö") || t.includes("tarjouspyynto")) score += 2;
  if (t.includes("hankintailmoitus")) score += 2;
  if (t.includes("jätä tarjous") || t.includes("jätä tarjouksen")) score += 2;
  if (t.includes("määräaika")) score += 1;
  if (t.includes("jättöaika") || t.includes("jattoaika")) score += 1;
  if (t.includes("urakka")) score += 1;
  if (t.includes("kilpailutus")) score += 1;
  return score >= 3;
}

function detectDocumentKind(text: string): DeterministicExtractionResult["document_kind"] {
  if (isComparisonDocument(text)) return "comparison_document";
  if (isDecisionDocument(text)) return "decision_document";
  if (isIndexPage(text)) return "index_page";
  if (isPlannedProcurement(text)) return "planned_procurement";
  if (isLiveProcurement(text)) return "live_procurement";
  return "unknown";
}

function inferNeutralDecisionTitle(text: string, municipalityName?: string | null) {
  const t = text.toLowerCase();
  const prefix = cleanLine(municipalityName || "Kunta");

  if (t.includes("tarjousvertailu") || t.includes("vertailu")) {
    return `${prefix}: Tarjousvertailu`;
  }
  if (t.includes("esityslista")) {
    return `${prefix}: Lautakunnan esityslista`;
  }
  if (t.includes("pöytäkirja") || t.includes("poytakirja")) {
    return `${prefix}: Lautakunnan pöytäkirja`;
  }
  if (t.includes("viranhaltijapäätös") || t.includes("viranhaltijapaatos")) {
    return `${prefix}: Viranhaltijapäätös`;
  }
  if (t.includes("hankintapäätös") || t.includes("hankintapaatos")) {
    return `${prefix}: Hankintapäätös`;
  }
  return `${prefix}: Päätösasiakirja`;
}

function normalizeCandidateTitle(line: string) {
  return cleanLine(
    line
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^[-•]\s*/, "")
      .replace(/\s+\|\s+/g, " ")
      .replace(/\b(yhteishankinnat|muut hankinnat)\b/gi, "")
      .replace(/\b(hallintotoimi|tekninen toimi|sivistystoimi|kaupunkikehitystoimi)\b/gi, "")
  );
}

function scoreTitleCandidate(line: string) {
  const t = line.toLowerCase();
  let score = 0;

  if (hasProcurementKeyword(line)) score += 60;
  if (line.length >= 6 && line.length <= 110) score += 20;
  if (t.includes("puisto")) score += 10;
  if (t.includes("viher")) score += 10;
  if (t.includes("hulevesi")) score += 10;
  if (t.includes("kaava")) score += 8;
  if (t.includes("selvitys")) score += 8;
  if (t.includes("urakka")) score += 8;
  if (t.includes("palvelu")) score += 8;

  if (isBadAdministrativeLine(line)) score -= 120;
  if (t.includes("vuonna 2026")) score -= 30;
  if (t.includes("vuonna 2027")) score -= 30;
  if (t.includes("vuonna 2028")) score -= 30;
  if (t.includes("kilpailutettavat hankinnat")) score -= 35;
  if (t.includes("suunnitellut hankinnat")) score -= 35;
  if (t.includes("hankinnat ja tarjouspyynnöt")) score -= 45;

  return score;
}

function inferTitle(input: Input, text: string, documentKind: DeterministicExtractionResult["document_kind"]) {
  if (documentKind === "decision_document" || documentKind === "comparison_document") {
    return inferNeutralDecisionTitle(text, input.municipalityName);
  }

  const lines = linesOf(text);
  const candidateLines = lines
    .map((line) => normalizeCandidateTitle(line))
    .filter(Boolean)
    .filter((line) => !isBadAdministrativeLine(line))
    .map((line) => ({ line, score: scoreTitleCandidate(line) }))
    .sort((a, b) => b.score - a.score);

  if (candidateLines.length > 0 && candidateLines[0].score >= 45) {
    return candidateLines[0].line.slice(0, 160);
  }

  const rawTitle = normalizeCandidateTitle(input.title || "");
  if (rawTitle && !isBadAdministrativeLine(rawTitle) && hasProcurementKeyword(rawTitle)) {
    return rawTitle.slice(0, 160);
  }

  if (documentKind === "planned_procurement") {
    return `${cleanLine(input.municipalityName || "Kunta")}: Suunniteltu hankinta`;
  }

  return `${cleanLine(input.municipalityName || "Kunta")}: Hankinta`;
}

function extractBuyer(text: string) {
  const patterns = [
    /(?:tilaaja|hankintayksikkö|hankintayksikko|ostaja)[:\s]+(.{3,120})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = cleanLine(match[1]);
      if (!isBadAdministrativeLine(value)) return value;
    }
  }

  return null;
}

function extractDeadline(text: string) {
  const patterns = [
    /(?:tarjoukset?.{0,40}?viimeistään|määräaika|deadline|jättöaika|jattoaika)[:\s]+(\d{1,2}\.\d{1,2}\.\d{4}(?:\s*klo\s*\d{1,2}[:.]\d{2})?)/i,
    /(\d{1,2}\.\d{1,2}\.\d{4}\s*klo\s*\d{1,2}[:.]\d{2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return {
        submission_deadline_text: cleanLine(match[1]),
        deadline_at: parseFinnishDate(match[1]),
      };
    }
  }

  return {
    submission_deadline_text: null,
    deadline_at: null,
  };
}

function extractPublishedAt(text: string) {
  const patterns = [
    /(?:julkaistu|julkaisupäivä|julkaisupaiva|päivätty|paivays)[:\s]+(\d{1,2}\.\d{1,2}\.\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return parseFinnishDate(match[1]);
  }

  return null;
}

function extractCPV(text: string) {
  const patterns = [
    /(?:cpv|cpv-koodi|cpv koodi)[:\s]+([0-9\- ]{4,40})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanLine(match[1]);
  }

  return null;
}

function extractLocation(text: string, municipalityName?: string | null) {
  const patterns = [
    /(?:sijainti|kohde sijaitsee|urakka-alue|urakka alue)[:\s]+(.{3,120})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = cleanLine(match[1]);
      if (!isBadAdministrativeLine(value)) return value;
    }
  }

  return cleanLine(municipalityName || "") || null;
}

function extractEstimatedValue(text: string, fileType: string) {
  const patterns =
    fileType === "pdf"
      ? [
          /(?:kokonaishinta|vertailuhinta|urakkahinta|sopimuksen arvo|arvonlisäveroton arvo|hankinnan arvo)[:\s]+([0-9][0-9 .,\u00a0]{2,})\s*(?:€|euroa?)/i,
          /([0-9][0-9 .,\u00a0]{4,})\s*€/,
        ]
      : [
          /(?:arvo|ennakoitu arvo|kokonaisarvo|hankinnan arvo|arvonlisäveroton arvo|arvioitu arvo|budjetti|kustannus)[:\s]+([0-9][0-9 .,\u00a0]{2,})\s*(?:€|euroa?)/i,
          /([0-9][0-9 .,\u00a0]{4,})\s*€/,
        ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseFinnishMoney(match[1]);
      if (value != null) return value;
    }
  }

  return null;
}

function extractPurchasableItems(text: string, title: string, fileType: string) {
  const lines = linesOf(text);
  const candidates = lines
    .map((line) => normalizeCandidateTitle(line))
    .filter(Boolean)
    .filter((line) => !isBadAdministrativeLine(line))
    .filter((line) => hasProcurementKeyword(line));

  const maxItems = fileType === "spreadsheet" || fileType === "csv" ? 8 : 6;
  const items = uniq([title, ...candidates]).filter((x) => hasProcurementKeyword(x)).slice(0, maxItems);

  return items;
}

function buildDescription(
  text: string,
  title: string,
  documentKind: DeterministicExtractionResult["document_kind"],
  fileType: string
) {
  if (documentKind === "decision_document") {
    return "Päätös- tai kokousasiakirja, joka liittyy jo käsiteltyyn hankintaan.";
  }

  const lines = linesOf(text)
    .map((line) => normalizeCandidateTitle(line))
    .filter(Boolean)
    .filter((line) => !isBadAdministrativeLine(line))
    .filter((line) => line.toLowerCase() !== title.toLowerCase());

  const useful = lines.filter((line) => hasProcurementKeyword(line));
  const chosen = useful.length > 0 ? useful : lines.slice(0, 3);

  const maxLen = fileType === "spreadsheet" || fileType === "csv" ? 220 : 280;
  let out = "";

  for (const line of chosen) {
    const next = out ? `${out} ${line}` : line;
    if (next.length > maxLen) break;
    out = next;
  }

  return out || title;
}

function buildSummary(params: {
  title: string;
  buyerName: string | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  submissionDeadlineText: string | null;
  estimatedValueEur: number | null;
  purchasableItems: string[];
  description: string;
}) {
  const parts: string[] = [];

  parts.push(params.description);

  if (params.buyerName) {
    parts.push(`Tilaaja: ${params.buyerName}.`);
  }

  if (params.submissionDeadlineText) {
    parts.push(`Tarjouksen jättöaika: ${params.submissionDeadlineText}.`);
  } else if (params.deadlineAt) {
    parts.push(`Deadline: ${params.deadlineAt.slice(0, 10)}.`);
  }

  if (params.estimatedValueEur != null) {
    parts.push(`Arvioitu arvo: ${new Intl.NumberFormat("fi-FI", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(params.estimatedValueEur)}.`);
  }

  if (params.purchasableItems.length > 1) {
    parts.push(`Kohteita: ${params.purchasableItems.slice(0, 3).join(", ")}.`);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function extractReasoningLabels(
  text: string,
  title: string,
  documentKind: DeterministicExtractionResult["document_kind"]
) {
  const haystack = `${title} ${text}`.toLowerCase();
  const labels = new Set<string>();

  if (haystack.includes("puisto") || haystack.includes("leikkipuisto")) labels.add("Puisto");
  if (haystack.includes("viher") || haystack.includes("viherrakent")) labels.add("Viher");
  if (haystack.includes("maisema")) labels.add("Maisema");
  if (haystack.includes("hulevesi")) labels.add("Hulevesi");
  if (haystack.includes("ulkoalue") || haystack.includes("piha")) labels.add("Ulkoalue");
  if (haystack.includes("istutus")) labels.add("Istutus");
  if (haystack.includes("asemakaava") || haystack.includes("osayleiskaava") || haystack.includes("kaava")) labels.add("Kaava");
  if (haystack.includes("maanrakenn") || haystack.includes("kunnossapito")) labels.add("Maanrakennus");

  if (documentKind === "planned_procurement") labels.add("Suunniteltu hankinta");
  if (documentKind === "live_procurement") labels.add("Avoin hankinta");
  if (documentKind === "decision_document") labels.add("Päätösasiakirja");
  if (documentKind === "comparison_document") labels.add("Tarjousvertailu");

  return Array.from(labels);
}

function buildPriorityScore(params: {
  documentKind: DeterministicExtractionResult["document_kind"];
  labels: string[];
  estimatedValueEur: number | null;
  titleQualityScore: number;
  contentQualityScore: number;
}) {
  let score = 20;

  if (params.documentKind === "live_procurement") score += 40;
  if (params.documentKind === "planned_procurement") score += 25;
  if (params.documentKind === "decision_document") score -= 40;
  if (params.documentKind === "comparison_document") score -= 30;
  if (params.documentKind === "index_page") score -= 30;

  for (const label of params.labels) {
    if (["Puisto", "Viher", "Maisema", "Hulevesi", "Ulkoalue"].includes(label)) score += 8;
    if (["Kaava", "Istutus", "Maanrakennus"].includes(label)) score += 5;
  }

  if (params.estimatedValueEur && params.estimatedValueEur >= 1000000) score += 15;
  else if (params.estimatedValueEur && params.estimatedValueEur >= 300000) score += 10;
  else if (params.estimatedValueEur && params.estimatedValueEur >= 100000) score += 5;

  score += Math.round(params.titleQualityScore / 10);
  score += Math.round(params.contentQualityScore / 12);

  return Math.max(0, Math.min(100, score));
}

function scoreTitleQuality(title: string, documentKind: DeterministicExtractionResult["document_kind"]) {
  let score = 0;
  if (title && !isBadAdministrativeLine(title)) score += 30;
  if (hasProcurementKeyword(title)) score += 45;
  if (title.length >= 6 && title.length <= 90) score += 15;
  if (documentKind === "live_procurement" || documentKind === "planned_procurement") score += 10;
  return Math.max(0, Math.min(100, score));
}

function scoreContentQuality(params: {
  description: string;
  purchasableItems: string[];
  buyerName: string | null;
  deadlineAt: string | null;
  estimatedValueEur: number | null;
  documentKind: DeterministicExtractionResult["document_kind"];
}) {
  let score = 0;
  if (params.description && !isBadAdministrativeLine(params.description)) score += 35;
  if (params.purchasableItems.length > 0) score += 35;
  if (params.buyerName) score += 10;
  if (params.deadlineAt) score += 10;
  if (params.estimatedValueEur != null) score += 10;
  if (params.documentKind === "decision_document" || params.documentKind === "index_page") score -= 30;
  return Math.max(0, Math.min(100, score));
}

function decideRejectReason(params: {
  documentKind: DeterministicExtractionResult["document_kind"];
  title: string;
  purchasableItems: string[];
  titleQualityScore: number;
  contentQualityScore: number;
}) {
  if (params.documentKind === "decision_document") return "decision_document";
  if (params.documentKind === "comparison_document") return "comparison_document";
  if (params.documentKind === "index_page") return "index_page";
  if (!hasProcurementKeyword(params.title) && params.purchasableItems.length === 0) {
    return "no_procurement_signal";
  }
  if (params.titleQualityScore < 45) return "weak_title";
  if (params.contentQualityScore < 35) return "weak_content";
  return null;
}

export async function extractProcurementFromText(
  input: Input
): Promise<DeterministicExtractionResult | null> {
  const text = cleanText(input.documentText);
  if (!text) return null;

  const fileType = detectFileType(input.contentType, input.filename);
  const documentKind = detectDocumentKind(text);
  const procurementTitle = inferTitle(input, text, documentKind);
  const buyerName = extractBuyer(text);
  const publishedAt = extractPublishedAt(text);
  const { deadline_at, submission_deadline_text } = extractDeadline(text);
  const cpv = extractCPV(text);
  const locationText = extractLocation(text, input.municipalityName);
  const estimatedValueEur = extractEstimatedValue(text, fileType);
  const purchasableItems = extractPurchasableItems(text, procurementTitle, fileType);
  const procurementDescription = buildDescription(text, procurementTitle, documentKind, fileType);
  const procurementSummary = buildSummary({
    title: procurementTitle,
    buyerName,
    publishedAt,
    deadlineAt: deadline_at,
    submissionDeadlineText: submission_deadline_text,
    estimatedValueEur,
    purchasableItems,
    description: procurementDescription,
  });
  const titleQualityScore = scoreTitleQuality(procurementTitle, documentKind);
  const contentQualityScore = scoreContentQuality({
    description: procurementDescription,
    purchasableItems,
    buyerName,
    deadlineAt: deadline_at,
    estimatedValueEur,
    documentKind,
  });
  const reasoningLabels = extractReasoningLabels(text, procurementTitle, documentKind);
  const rejectReason = decideRejectReason({
    documentKind,
    title: procurementTitle,
    purchasableItems,
    titleQualityScore,
    contentQualityScore,
  });

  const confidence = Math.max(
    0.2,
    Math.min(0.98, (titleQualityScore * 0.45 + contentQualityScore * 0.55) / 100)
  );

  const priorityScore = buildPriorityScore({
    documentKind,
    labels: reasoningLabels,
    estimatedValueEur,
    titleQualityScore,
    contentQualityScore,
  });

  return {
    procurement_title: procurementTitle,
    procurement_description: procurementDescription,
    procurement_summary: procurementSummary,
    purchasable_items: purchasableItems,
    estimated_value_eur: estimatedValueEur,
    published_at: publishedAt,
    deadline_at,
    submission_deadline_text,
    buyer_name: buyerName,
    location_text: locationText,
    cpv,
    confidence,
    priority_score: priorityScore,
    reasoning_labels: reasoningLabels,
    document_kind: documentKind,
    title_quality_score: titleQualityScore,
    content_quality_score: contentQualityScore,
    reject_reason: rejectReason,
  };
}
