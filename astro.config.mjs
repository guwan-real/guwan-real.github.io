import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import { remarkNoRawHtml, reviewSanitizeSchema } from "./scripts/markdown-safety.mjs";

export default defineConfig({
  site: "https://guwan-real.github.io",
  markdown: {
    processor: unified({
      remarkPlugins: [remarkCjkFriendly, remarkNoRawHtml, remarkMath],
      rehypePlugins: [[rehypeSanitize, reviewSanitizeSchema], [rehypeKatex, { trust: false, strict: "ignore" }]],
    }),
    shikiConfig: { theme: "github-light" },
  },
});
