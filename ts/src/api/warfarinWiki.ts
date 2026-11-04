/**
 * Read-only Warfarin Wiki adapter.
 *
 * Warfarin serves server-rendered HTML, not the MediaWiki API used by the
 * Talos Wiki client. Keep HTML parsing and network access isolated here.
 * Requests are deliberately serialised and responses are bounded so this
 * small MCP does not act as a bulk mirror of the fan-maintained website.
 */

const BASE = "https://warfarin.wiki";
const MAX_HTML_BYTES = 8_000_000;
const REQUEST_INTERVAL_MS = 1_000;
const ALLOWED_CATEGORIES = [
  "operators", "weapons", "gear", "enemies", "facilities", "items",
  "tutorials", "lore", "missions",
] as const;

export type WarfarinCategory = (typeof ALLOWED_CATEGORIES)[number];
export type WarfarinLocale = "br" | "en";

export interface WarfarinResult {
  title: string;
  path: string;
  url: string;
}

let nextRequestTime = 0;

function decodeEntities(raw: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…", bull: "•", rsquo: "’",
  };
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, value: string) => {
    if (value.startsWith("#")) {
      const number = value[1]?.toLowerCase() === "x"
        ? parseInt(value.slice(2), 16)
        : parseInt(value.slice(1), 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : match;
    }
    return named[value.toLowerCase()] ?? match;
  });
}

function mainContent(html: string): string {
  const start = html.search(/<main(?:\s|>)/i);
  if (start === -1) throw new Error("Warfarin não retornou o conteúdo da página.");
  const openingEnd = html.indexOf(">", start);
  const end = html.indexOf("</main>", openingEnd);
  if (end === -1) throw new Error("A estrutura HTML da Warfarin mudou.");
  return html.slice(openingEnd + 1, end);
}

function asPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Extract exact article links from one Warfarin category page. */
export function extractWarfarinLinks(
  html: string,
  locale: WarfarinLocale,
  category: WarfarinCategory,
): WarfarinResult[] {
  const main = mainContent(html);
  const expression = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const expected = new RegExp(`^/${locale}/${category}/[a-z0-9-]+$`);
  const seen = new Set<string>();
  const result: WarfarinResult[] = [];
  for (const match of main.matchAll(expression)) {
    const path = decodeEntities(match[1] ?? "");
    if (!expected.test(path) || seen.has(path)) continue;
    const title = asPlainText(match[2] ?? "").replace(/★/g, "").trim();
    if (!title) continue;
    seen.add(path);
    result.push({ title, path, url: BASE + path });
  }
  return result;
}

/** Turn a single article's main content into concise, readable Markdown. */
export function extractWarfarinText(html: string): string {
  const main = mainContent(html)
    .replace(/<(script|style|svg|nav|button)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<h1\b[^>]*>/gi, "\n# ")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h4\b[^>]*>/gi, "\n#### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<tr\b[^>]*>/gi, "\n")
    .replace(/<(?:th|td)\b[^>]*>/gi, " | ")
    .replace(/<\/(?:p|section|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(main)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function getHtml(path: string): Promise<string> {
  const current = Date.now();
  const scheduled = Math.max(current, nextRequestTime);
  nextRequestTime = scheduled + REQUEST_INTERVAL_MS;
  if (scheduled > current) {
    await new Promise<void>((resolve) => setTimeout(resolve, scheduled - current));
  }
  const response = await fetch(BASE + path, {
    headers: { Accept: "text/html", "User-Agent": "Endfield-MCP/0.4 (read-only reference)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Warfarin indisponível (HTTP ${response.status}).`);
  const html = await response.text();
  if (html.length > MAX_HTML_BYTES) throw new Error("Página da Warfarin grande demais para consulta.");
  return html;
}

/** Find matching article titles in one category; never crawl all pages. */
export async function searchWarfarin(
  category: WarfarinCategory,
  query: string,
  locale: WarfarinLocale = "br",
  limit = 10,
): Promise<WarfarinResult[]> {
  const links = extractWarfarinLinks(await getHtml(`/${locale}/${category}`), locale, category);
  const needle = normalize(query.trim());
  return links.filter((item) => normalize(item.title).includes(needle)).slice(0, limit);
}

/** Read a Warfarin article by the exact path returned by searchWarfarin. */
export async function readWarfarin(
  path: string,
  section?: string,
  maxChars = 12_000,
): Promise<string> {
  const allowed = /^\/(?:br|en)\/(?:operators|weapons|gear|enemies|facilities|items|tutorials|lore|missions)\/[a-z0-9-]+$/;
  if (!allowed.test(path)) {
    throw new Error("Caminho inválido. Use o path retornado por ef_search_warfarin.");
  }
  let body = extractWarfarinText(await getHtml(path));
  if (section) {
    const lines = body.split("\n");
    const wanted = normalize(section.trim());
    const begin = lines.findIndex((line) => /^#{1,4} /.test(line) && normalize(line.replace(/^#+ /, "")).includes(wanted));
    if (begin === -1) {
      const headings = lines.filter((line) => /^#{1,4} /.test(line)).slice(0, 35);
      return `Seção "${section}" não encontrada. Títulos disponíveis:\n${headings.join("\n")}`;
    }
    const level = lines[begin]?.match(/^#+/)?.[0].length ?? 2;
    let end = begin + 1;
    while (end < lines.length) {
      const headingLevel = lines[end]?.match(/^#+(?= )/)?.[0].length;
      if (headingLevel !== undefined && headingLevel <= level) break;
      end++;
    }
    body = lines.slice(begin, end).join("\n");
  }
  const clipped = body.length > maxChars;
  const text = clipped ? body.slice(0, maxChars).trimEnd() + "\n[Conteúdo abreviado]" : body;
  return `Fonte: ${BASE}${path}\n\n${text}`;
}
