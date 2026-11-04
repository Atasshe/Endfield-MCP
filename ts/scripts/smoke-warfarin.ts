/** Explicit opt-in live smoke: two polite requests to warfarin.wiki. */
import { readWarfarin, searchWarfarin } from "../src/api/warfarinWiki.js";

const matches = await searchWarfarin("operators", "Endministrator", "br", 3);
const target = matches.find((item) => item.path === "/br/operators/endministrator");
if (!target) throw new Error("Warfarin operator list did not include Endministrator");

const article = await readWarfarin(target.path, undefined, 6000);
if (!article.includes("Endministrator") || !article.includes("warfarin.wiki/br/operators/endministrator")) {
  throw new Error("Warfarin operator page did not contain expected content");
}

process.stderr.write(`Warfarin live smoke OK: ${target.url}\n`);
