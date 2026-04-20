import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { supabaseAdmin } from "../src/lib/supabase-admin";
import { scoreLandscapeProcurement } from "../src/lib/scoring";
import { fetchMunicipalitySource } from "../src/lib/crawler";
import { getActiveMunicipalityLinks } from "../src/lib/municipality-links";
import {
  buildDedupFingerprint,
  buildDocumentSourceHash,
  extractStructuredFields,
  normalizeProcurementTitle,
  splitDocumentIntoProcurementItems,
} from "../src/lib/document-intelligence";
import { extractProcurementFromText } from "../src/lib/ai-procurement-extraction";

type ProcurementInput = {
  external_id: string;
  source: string;
  title: string;
  description: string;
  location?: string;
  url?: string;
  deadline_at?: string;
  published_at?: string;
  submission_deadline_text?: string;
  status?: string;
  documents?: {
    filename: string;
    file_url: string;
    extracted_text: string;
    content_type: string;
  }[];
};

type CrawledSourceInput = {
  id: number;
  municipality_id: number;
  label: string;
  url: string;
  link_type: string | null;
  include_patterns: string[] | null;
  exclude_patterns: string[] | null;
  keywords: string[] | null;
  document_types: string[] | null;
  is_active: boolean;
  notes: string | null;
  municipality: {
    id: number;
    name: string;
    slug: string | null;
    is_active: boolean;
    is_monitored: boolean | null;
    notes: string | null;
  } | null;
};

type ContentKind =
  | "live_procurement"
  | "planned_procurement"
  | "procurement_index_page"
  | "multi_item_plan_document"
  | "decision_document"
  | "noise";

function parseMunicipalityLinkIdArg() {
  const raw = process.argv.find((arg) => arg.startsWith("--link-id="));
  if (!raw) return null;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) ? value : null;
}

function clampPercent(value: number) {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function cleanLine(input?: string | null) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function looksBadTitle(text?: string | null) {
  const t = cleanLine(text).toLowerCase();
  if (!t || t.length < 4) return true;

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
    t.includes("tarjoukset vastaanotettiin") ||
    t.includes("muutoksenhakukirjelmässä") ||
    t.includes("muutoksenhakukirjelmassa") ||
    t.includes("oy malgon ltd") ||
    t.includes("hankintapäätös") ||
    t.includes("hankintapaatos") ||
    t.includes("viranhaltijapäätös") ||
    t.includes("viranhaltijapaatos")
  );
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

function buildCrawlerSource(link: CrawledSourceInput) {
  const municipalityName = link.municipality?.name ?? "Tuntematon kunta";

  return {
    id: link.id,
    name: `${municipalityName} / ${link.label}`,
    organization: municipalityName,
    source_type: link.link_type || "municipality_page",
    base_url: link.url,
    start_urls: [link.url],
    include_patterns:
      link.include_patterns && link.include_patterns.length > 0
        ? link.include_patterns
        : ["hankinta", "tarjous", "kilpailu", "urakka", "rakentaminen", "investointi", "puisto", "viher"],
    exclude_patterns:
      link.exclude_patterns && link.exclude_patterns.length > 0
        ? link.exclude_patterns
        : ["/wp-admin/", "/feed/", "facebook", "instagram", "linkedin"],
    keywords:
      link.keywords && link.keywords.length > 0
        ? link.keywords
        : ["puisto", "viherrakentaminen", "maisemasuunnittelu", "ulkoalue", "hulevesi", "leikkipuisto", "ympäristörakentaminen"],
    document_types:
      link.document_types && link.document_types.length > 0
        ? link.document_types
        : ["html", "pdf", "doc", "docx", "xls", "xlsx", "csv", "jpg", "jpeg", "png", "webp"],
    is_active: link.is_active,
    crawl_frequency: "daily",
    notes: link.notes,
  };
}

function summarizeText(input: string, maxLen = 700) {
  const clean = input.replace(/\s+/g, " ").trim();
  if (!clean) return "Ei tiivistelmää saatavilla.";

  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let summary = "";

  for (const sentence of sentences) {
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (next.length > maxLen) break;
    summary = next;
  }

  return summary || clean.slice(0, maxLen);
}

function buildFallbackSummary(item: ProcurementInput) {
  const docText = (item.documents || []).map((d) => d.extracted_text).join(" ");
  return summarizeText(`${item.description || ""} ${docText}`);
}

function inferReadableTitle(params: {
  rawTitle: string;
  location?: string | null;
  publishedAt?: string | null;
  submissionDeadlineText?: string | null;
  fieldsTitle?: string | null;
  categoryHint?: string | null;
}) {
  const raw = cleanLine(params.fieldsTitle || params.rawTitle || "");
  const year =
    params.publishedAt?.slice(0, 4) ||
    (params.submissionDeadlineText?.match(/\b(20\d{2})\b/)?.[1] ?? "");

  const prefix = params.location ? `${params.location}${year ? ` ${year}` : ""}: ` : "";

  if (!raw || looksBadTitle(raw)) {
    if (params.categoryHint) return `${prefix}${params.categoryHint}`;
    return `${prefix}Hankinta`;
  }

  return raw;
}

function looksLandscapeRelevant(text: string) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("puisto") ||
    t.includes("viher") ||
    t.includes("viherrakent") ||
    t.includes("maisema") ||
    t.includes("hulevesi") ||
    t.includes("leikkipuisto") ||
    t.includes("ulkoalue") ||
    t.includes("ympäristörakent") ||
    t.includes("ymparistorakent") ||
    t.includes("piha") ||
    t.includes("katuympäristö") ||
    t.includes("katuymparisto") ||
    t.includes("istutus")
  );
}

function classifyContent(params: {
  title: string;
  description: string;
  url?: string | null;
  hasDocuments: boolean;
  splitItemCount: number;
  deadlineAt?: string | null;
  submissionDeadlineText?: string | null;
  extractedDocumentKind?: string | null;
}) {
  if (params.extractedDocumentKind === "decision_document") {
    return { contentKind: "decision_document" as ContentKind, opportunitySignalScore: 8, isActionable: false };
  }
  if (params.extractedDocumentKind === "comparison_document") {
    return { contentKind: "decision_document" as ContentKind, opportunitySignalScore: 8, isActionable: false };
  }
  if (params.extractedDocumentKind === "index_page") {
    return { contentKind: "procurement_index_page" as ContentKind, opportunitySignalScore: 10, isActionable: false };
  }
  if (params.extractedDocumentKind === "planned_procurement") {
    return { contentKind: "planned_procurement" as ContentKind, opportunitySignalScore: 68, isActionable: true };
  }
  if (params.extractedDocumentKind === "live_procurement") {
    return { contentKind: "live_procurement" as ContentKind, opportunitySignalScore: 86, isActionable: true };
  }

  const text = `${params.title} ${params.description} ${params.url || ""}`.toLowerCase();

  if (params.splitItemCount >= 2) {
    return { contentKind: "multi_item_plan_document" as ContentKind, opportunitySignalScore: 72, isActionable: true };
  }

  if (looksLandscapeRelevant(text) && (params.deadlineAt || params.submissionDeadlineText)) {
    return { contentKind: "planned_procurement" as ContentKind, opportunitySignalScore: 58, isActionable: true };
  }

  if (looksLandscapeRelevant(text)) {
    return { contentKind: "planned_procurement" as ContentKind, opportunitySignalScore: 46, isActionable: true };
  }

  return { contentKind: "noise" as ContentKind, opportunitySignalScore: 0, isActionable: false };
}

function shouldRejectProcurement(params: {
  title?: string | null;
  purchasableItems?: string[] | null;
  contentKind?: string | null;
  rejectReason?: string | null;
  titleQualityScore?: number | null;
  contentQualityScore?: number | null;
}) {
  if (params.contentKind === "decision_document") return true;
  if (params.contentKind === "procurement_index_page") return true;
  if (params.contentKind === "noise") return true;
  if (params.rejectReason) return true;

  const titleHasKeyword = hasProcurementKeyword(params.title || "");
  const itemsFound = Array.isArray(params.purchasableItems) && params.purchasableItems.length > 0;

  if (!titleHasKeyword && !itemsFound) return true;
  if ((params.titleQualityScore ?? 100) < 45) return true;
  if ((params.contentQualityScore ?? 100) < 35) return true;

  return false;
}

async function scoreProcurement(
  procurementId: number,
  title: string,
  description: string,
  url?: string | null
) {
  const score = scoreLandscapeProcurement({
    title,
    description,
    url: url ?? null,
  });

  await supabaseAdmin.from("procurement_scores").upsert(
    {
      procurement_id: procurementId,
      relevance_score: score.score,
      category: score.category,
      rationale: score.rationale,
      matched_keywords: score.matchedKeywords,
    },
    { onConflict: "procurement_id" }
  );

  return score.score;
}

async function updateProgress(params: {
  municipalityLinkId: number;
  percent: number;
  text: string;
  foundCount?: number;
  lastStatus?: string | null;
  errorText?: string | null;
  running?: boolean;
  successAt?: boolean;
}) {
  const now = new Date().toISOString();

  await supabaseAdmin.from("municipality_link_crawl_status").upsert(
    {
      municipality_link_id: params.municipalityLinkId,
      last_crawled_at: now,
      last_success_at: params.successAt ? now : undefined,
      last_status: params.lastStatus ?? null,
      last_error: params.errorText ?? null,
      last_found_count: params.foundCount ?? 0,
      progress_percent: clampPercent(params.percent),
      progress_text: params.text,
      is_running: params.running ?? true,
      updated_at: now,
    },
    { onConflict: "municipality_link_id" }
  );
}

async function saveDocuments(
  procurementId: number,
  parentItem: ProcurementInput,
  documents?: ProcurementInput["documents"]
) {
  if (!documents || documents.length === 0) return 0;

  let totalSplitItems = 0;

  for (const doc of documents) {
    const extractedFields = extractStructuredFields(doc.extracted_text);

    const { data: savedDoc, error } = await supabaseAdmin
      .from("source_documents")
      .upsert(
        {
          procurement_id: procurementId,
          filename: doc.filename,
          file_url: doc.file_url,
          extracted_text: doc.extracted_text,
          content_type: doc.content_type,
          extracted_fields: extractedFields,
        },
        { onConflict: "procurement_id,file_url" }
      )
      .select()
      .single();

    if (error || !savedDoc) continue;

    const splitItems = splitDocumentIntoProcurementItems(doc.extracted_text);

    await supabaseAdmin
      .from("document_procurement_items")
      .delete()
      .eq("source_document_id", savedDoc.id);

    for (const splitItem of splitItems) {
      if (!hasProcurementKeyword(splitItem.itemTitle) && !hasProcurementKeyword(splitItem.rawText)) {
        continue;
      }

      await supabaseAdmin.from("document_procurement_items").insert({
        source_document_id: savedDoc.id,
        procurement_id: procurementId,
        item_index: splitItem.itemIndex,
        item_title: splitItem.itemTitle,
        buyer_name: splitItem.buyerName ?? null,
        published_at: splitItem.publishedAt ?? null,
        deadline_at: splitItem.deadlineAt ?? null,
        submission_deadline_text: splitItem.submissionDeadlineText ?? null,
        location_text: splitItem.locationText ?? null,
        cpv_text: splitItem.cpvText ?? null,
        ai_summary: splitItem.aiSummary,
        raw_text: splitItem.rawText,
      });

      totalSplitItems += 1;
    }
  }

  return totalSplitItems;
}

async function createAlertMatches(
  procurementId: number,
  item: ProcurementInput,
  score: number
) {
  const { data: watchlists, error } = await supabaseAdmin
    .from("user_watchlists")
    .select("*")
    .eq("is_active", true);

  if (error) throw error;

  const searchable = `${item.title} ${item.description}`.toLowerCase();

  for (const watchlist of watchlists ?? []) {
    const keywords = Array.isArray(watchlist.keywords)
      ? watchlist.keywords.map((x: unknown) => String(x))
      : [];

    const matchedKeywords = keywords.filter((kw) => searchable.includes(kw.toLowerCase()));

    if (score >= watchlist.min_score && matchedKeywords.length > 0) {
      await supabaseAdmin.from("alert_matches").upsert(
        {
          user_email: watchlist.user_email,
          procurement_id: procurementId,
          watchlist_id: watchlist.id,
          matched_keywords: matchedKeywords,
        },
        { onConflict: "user_email,procurement_id,watchlist_id" }
      );
    }
  }
}

async function finalizeStatus(params: {
  municipalityLinkId: number;
  status: string;
  foundCount: number;
  errorText?: string | null;
  success?: boolean;
}) {
  const now = new Date().toISOString();

  await supabaseAdmin.from("municipality_link_crawl_status").upsert(
    {
      municipality_link_id: params.municipalityLinkId,
      last_crawled_at: now,
      last_success_at: params.success ? now : undefined,
      last_status: params.status,
      last_error: params.errorText ?? null,
      last_found_count: params.foundCount,
      progress_percent: 100,
      progress_text: params.status === "error" ? "Virhe" : "Valmis",
      is_running: false,
      updated_at: now,
    },
    { onConflict: "municipality_link_id" }
  );
}

async function upsertProcurement(item: ProcurementInput) {
  const extraction = await buildExtraction(item);

  const splitItemCountEstimate = item.documents?.length
    ? splitDocumentIntoProcurementItems(item.documents[0].extracted_text).length
    : 0;

  const contentMeta = classifyContent({
    title: extraction.cleanedTitle,
    description: extraction.summary,
    url: item.url ?? null,
    hasDocuments: (item.documents?.length || 0) > 0,
    splitItemCount: splitItemCountEstimate,
    deadlineAt: extraction.deadlineAt,
    submissionDeadlineText: extraction.submissionDeadlineText,
    extractedDocumentKind: extraction.documentKind,
  });

  if (
    shouldRejectProcurement({
      title: extraction.cleanedTitle,
      purchasableItems: extraction.purchasableItems,
      contentKind: contentMeta.contentKind,
      rejectReason: extraction.rejectReason,
      titleQualityScore: extraction.titleQualityScore,
      contentQualityScore: extraction.contentQualityScore,
    })
  ) {
    console.log(`❌ Rejected procurement: ${extraction.cleanedTitle}`);
    return;
  }

  const normalizedTitle = normalizeProcurementTitle(extraction.cleanedTitle);
  const documentSourceHash = buildDocumentSourceHash({
    sourceUrl: item.url || null,
    fileUrl: item.documents?.[0]?.file_url || null,
    filename: item.documents?.[0]?.filename || null,
  });

  const dedupFingerprint = buildDedupFingerprint({
    normalizedTitle,
    location: extraction.location || item.location || null,
    deadlineAt: extraction.deadlineAt || item.deadline_at || null,
    buyerName: extraction.buyerName || null,
    cpvText: extraction.cpvText || null,
    documentSourceHash,
  });

  const existing = await supabaseAdmin
    .from("procurements")
    .select("id")
    .eq("dedup_fingerprint", dedupFingerprint)
    .eq("is_split_item", false)
    .limit(1)
    .maybeSingle();

  let procurementId: number | null = null;

  const basePayload = {
    external_id: item.external_id,
    source: item.source,
    title: extraction.cleanedTitle,
    normalized_title: normalizedTitle,
    dedup_fingerprint: dedupFingerprint,
    buyer_name: extraction.buyerName,
    cpv_text: extraction.cpvText,
    document_source_hash: documentSourceHash,
    description: extraction.description,
    ai_summary: extraction.summary,
    location: extraction.location || item.location,
    url: item.url,
    original_source_url: item.url,
    deadline_at: extraction.deadlineAt || item.deadline_at,
    published_at: extraction.publishedAt || item.published_at || null,
    submission_deadline_text: extraction.submissionDeadlineText || item.submission_deadline_text || null,
    status: item.status,
    content_kind: contentMeta.contentKind,
    opportunity_signal_score: contentMeta.opportunitySignalScore,
    is_actionable: contentMeta.isActionable,
    estimated_value_eur: extraction.estimatedValueEur,
    ai_confidence: extraction.confidence,
    ai_reasoning_labels: extraction.reasoningLabels,
    purchasable_items: extraction.purchasableItems,
    raw_json: {
      ...item,
      deterministic_extraction: extraction,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing.data?.id) {
    const { data: updated, error } = await supabaseAdmin
      .from("procurements")
      .update(basePayload)
      .eq("id", existing.data.id)
      .select("id")
      .single();

    if (error) throw error;
    procurementId = updated?.id ?? null;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("procurements")
      .insert({
        ...basePayload,
        is_split_item: false,
      })
      .select("id")
      .single();

    if (error) throw error;
    procurementId = inserted?.id ?? null;
  }

  if (!procurementId) {
    throw new Error("Procurement upsert failed");
  }

  const score = await scoreProcurement(
    procurementId,
    extraction.cleanedTitle,
    extraction.summary,
    item.url ?? null
  );

  await saveDocuments(procurementId, item, item.documents);
  await createAlertMatches(procurementId, item, score);
}

async function buildExtraction(item: ProcurementInput) {
  const primaryDocument = item.documents?.[0];
  const extracted = primaryDocument?.extracted_text
    ? await extractProcurementFromText({
        municipalityName: item.location || null,
        sourceName: item.source || null,
        url: item.url || null,
        title: item.title || null,
        description: item.description || null,
        documentText: primaryDocument.extracted_text,
        contentType: primaryDocument.content_type || null,
        filename: primaryDocument.filename || null,
      })
    : null;

  const primaryFields = primaryDocument
    ? extractStructuredFields(primaryDocument.extracted_text)
    : {};

  const cleanedTitle =
    extracted?.procurement_title?.trim() && !looksBadTitle(extracted.procurement_title)
      ? extracted.procurement_title.trim()
      : inferReadableTitle({
          rawTitle: item.title,
          location: item.location ?? null,
          publishedAt: extracted?.published_at ?? item.published_at ?? primaryFields.publishedAt ?? null,
          submissionDeadlineText:
            extracted?.submission_deadline_text ??
            item.submission_deadline_text ??
            primaryFields.submissionDeadlineText ??
            null,
          fieldsTitle: primaryFields.title || null,
        });

  const description =
    extracted?.procurement_description?.trim() ||
    summarizeText(item.description || "", 220) ||
    "Ei kuvausta saatavilla.";

  const summary =
    extracted?.procurement_summary?.trim() ||
    extracted?.procurement_description?.trim() ||
    buildFallbackSummary(item);

  return {
    cleanedTitle,
    description,
    summary,
    buyerName: extracted?.buyer_name || primaryFields.buyerName || null,
    publishedAt: extracted?.published_at || item.published_at || primaryFields.publishedAt || null,
    deadlineAt: extracted?.deadline_at || item.deadline_at || primaryFields.deadlineAt || null,
    submissionDeadlineText:
      extracted?.submission_deadline_text ||
      item.submission_deadline_text ||
      primaryFields.submissionDeadlineText ||
      null,
    location: extracted?.location_text || item.location || primaryFields.locationText || null,
    cpvText: extracted?.cpv || primaryFields.cpvText || null,
    estimatedValueEur: extracted?.estimated_value_eur ?? primaryFields.estimatedValueEur ?? null,
    purchasableItems: extracted?.purchasable_items ?? [],
    confidence: extracted?.confidence ?? null,
    reasoningLabels: extracted?.reasoning_labels ?? [],
    documentKind: extracted?.document_kind ?? null,
    titleQualityScore: extracted?.title_quality_score ?? null,
    contentQualityScore: extracted?.content_quality_score ?? null,
    rejectReason: extracted?.reject_reason ?? null,
  };
}

type RunOptions = {
  municipalityLinkId?: number | null;
};

async function runSync(options?: RunOptions) {
  const links = await getActiveMunicipalityLinks();
  const filteredLinks =
    options?.municipalityLinkId
      ? links.filter((link) => link.id === options.municipalityLinkId)
      : links;

  console.log(`Monitored municipality links: ${filteredLinks.length}`);

  if (filteredLinks.length === 0) {
    console.log("No monitored municipalities or active links found.");
    return;
  }

  for (let i = 0; i < filteredLinks.length; i++) {
    const link = filteredLinks[i];
    const municipalityName = link.municipality?.name ?? "Tuntematon kunta";
    const sourceName = `${municipalityName} / ${link.label}`;

    console.log(`Crawling: ${sourceName} (${link.url})`);

    try {
      await updateProgress({
        municipalityLinkId: link.id,
        percent: 0,
        text: `Jonossa (${i + 1}/${filteredLinks.length})`,
        foundCount: 0,
        lastStatus: "running",
        running: true,
      });

      const crawlerSource = buildCrawlerSource(link as unknown as CrawledSourceInput);

      await updateProgress({
        municipalityLinkId: link.id,
        percent: 10,
        text: "Ladataan lähdettä",
        foundCount: 0,
        lastStatus: "running",
        running: true,
      });

      const items = await fetchMunicipalitySource(crawlerSource);

      await updateProgress({
        municipalityLinkId: link.id,
        percent: 35,
        text: `Löydetty ${items.length} ehdokasta`,
        foundCount: items.length,
        lastStatus: "running",
        running: true,
      });

      console.log(`Found ${items.length} candidates from ${sourceName}`);

      if (items.length === 0) {
        await finalizeStatus({
          municipalityLinkId: link.id,
          status: "no_matches",
          foundCount: 0,
          success: true,
          errorText: null,
        });
        continue;
      }

      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const item = items[itemIndex];
        const percent = 35 + Math.round(((itemIndex + 1) / items.length) * 55);

        await updateProgress({
          municipalityLinkId: link.id,
          percent,
          text: `Käsitellään löydöksiä (${itemIndex + 1}/${items.length})`,
          foundCount: items.length,
          lastStatus: "running",
          running: true,
        });

        await upsertProcurement({
          ...item,
          source: sourceName,
          location: municipalityName,
        });
      }

      await finalizeStatus({
        municipalityLinkId: link.id,
        status: "success",
        foundCount: items.length,
        success: true,
        errorText: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown crawl error";

      console.error(`Crawl failed for ${sourceName}:`, error);

      await finalizeStatus({
        municipalityLinkId: link.id,
        status: "error",
        foundCount: 0,
        success: false,
        errorText: message,
      });
    }
  }
}

async function main() {
  const municipalityLinkId = parseMunicipalityLinkIdArg();
  await runSync({
    municipalityLinkId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
