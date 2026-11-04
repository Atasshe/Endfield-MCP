import { afterEach, describe, expect, it } from "bun:test";
import {
  extractWarfarinLinks,
  extractWarfarinText,
  readWarfarin,
  searchWarfarin,
} from "../src/api/warfarinWiki.js";

const listing = `<html><aside><a href="/br/operators/fake">Sidebar</a></aside>
<main><h1>Operadores</h1>
<a href="/br/operators/endministrator"><div><span>Endministrator</span><span>★★★★★★</span></div></a>
<a href="/br/operators/chen-qianyu"><span>Chen Qianyu</span></a>
<a href="/br/weapons/finishing-call"><span>Arma</span></a>
</main><script>window.data={"secret":"ignore"}</script></html>`;

const article = `<html><aside>Menu</aside><main><h1>Endministrator</h1>
<section><h2>Visão Geral</h2><p>Personagem &amp; operador.</p></section>
<section><h2>Habilidades de Combate</h2><h3>Sequência</h3>
<table><tr><th>Nível</th><td>90</td></tr></table>
<p>Dano &#37; e potência.</p></section><h2>Arquivos</h2><p>Lore.</p>
</main><footer>Rodapé</footer></html>`;

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Warfarin HTML adapter", () => {
  it("extracts only matching links from the requested category", () => {
    expect(extractWarfarinLinks(listing, "br", "operators")).toEqual([
      {
        title: "Endministrator",
        path: "/br/operators/endministrator",
        url: "https://warfarin.wiki/br/operators/endministrator",
      },
      {
        title: "Chen Qianyu",
        path: "/br/operators/chen-qianyu",
        url: "https://warfarin.wiki/br/operators/chen-qianyu",
      },
    ]);
  });

  it("retains headings and table data, excludes navigation and scripts", () => {
    const output = extractWarfarinText(article);
    expect(output).toContain("# Endministrator");
    expect(output).toContain("## Habilidades de Combate");
    expect(output).toContain("Nível | 90");
    expect(output).toContain("Personagem & operador.");
    expect(output).not.toContain("Rodapé");
    expect(output).not.toContain("Menu");
  });

  it("supports category search and section-limited reading", async () => {
    globalThis.fetch = async (url: string | URL | Request) =>
      new Response(String(url).endsWith("/operators") ? listing : article, { status: 200 });
    const results = await searchWarfarin("operators", "ENDMIN", "br");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Endministrator");
    const text = await readWarfarin("/br/operators/endministrator", "Habilidades de Combate");
    expect(text).toContain("Nível | 90");
    expect(text).not.toContain("Arquivos");
    expect(text).toContain("https://warfarin.wiki/br/operators/endministrator");
  });

  it("rejects paths outside known Warfarin article routes", async () => {
    expect(readWarfarin("https://example.com/evil")).rejects.toThrow("Caminho inválido");
    expect(readWarfarin("/br/../admin")).rejects.toThrow("Caminho inválido");
  });

  it("reports upstream HTTP failures clearly", async () => {
    globalThis.fetch = async () => new Response("blocked", { status: 403 });
    expect(searchWarfarin("operators", "Endministrator")).rejects.toThrow("HTTP 403");
  });
});
