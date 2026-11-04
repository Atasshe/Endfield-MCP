/** Warfarin Wiki lookups complement, but do not replace, Talos MediaWiki. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readWarfarin, searchWarfarin } from "../api/warfarinWiki.js";

export function registerWarfarinTools(server: McpServer): void {
  server.tool(
    "ef_search_warfarin",
    "在 Warfarin Wiki 搜索《明日方舟：终末地》资料。可搜索角色、武器、装备、敌人、道具、设施、任务和世界观文章。支持葡语和英语，返回可供 ef_read_warfarin 使用的 path 与网页链接。",
    {
      category: z.enum(["operators", "weapons", "gear", "enemies", "facilities", "items", "tutorials", "lore", "missions"]).describe("搜索分类，如 operators、weapons、gear、lore。"),
      query: z.string().min(1).max(100).describe("名称关键词，可使用葡语或英语。"),
      locale: z.enum(["br", "en"]).default("br").describe("语言：br 为葡萄牙语（默认），en 为英语。"),
      limit: z.number().int().min(1).max(20).default(10).describe("最多返回 20 条。"),
    },
    async ({ category, query, locale, limit }) => {
      try {
        const results = await searchWarfarin(category, query, locale, limit);
        const text = results.length === 0
          ? `Warfarin: não encontrei resultados para "${query}" na categoria ${category}.`
          : results.map((item) => `**${item.title}**\npath: ${item.path}\n${item.url}`).join("\n\n---\n\n");
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  );

  server.tool(
    "ef_read_warfarin",
    "读取 Warfarin Wiki 的游戏资料页面（巴西葡萄牙语或英语）。适合查看角色数值/技能倍率、装备、武器、任务等结构化数据；先用 ef_search_warfarin 获取 path。支持仅截取指定标题的章节，始终附带来源链接。",
    {
      path: z.string().describe("ef_search_warfarin 返回的 /br/... 或 /en/... 相对路径。"),
      section: z.string().max(100).optional().describe("可选章节标题，如 Habilidades de Combate / Combat Skills。"),
      max_chars: z.number().int().min(1000).max(30000).default(12000).describe("返回内容最大字符数，默认 12000。"),
    },
    async ({ path, section, max_chars }) => {
      try {
        return { content: [{ type: "text", text: await readWarfarin(path, section, max_chars) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  );
}
