import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import { remarkNoRawHtml, reviewSanitizeSchema } from '../../../scripts/markdown-safety.mjs';

const processor = createMarkdownProcessor({
  remarkPlugins: [remarkNoRawHtml, remarkMath],
  rehypePlugins: [[rehypeSanitize, reviewSanitizeSchema], [rehypeKatex, { trust: false, strict: 'ignore' }]],
  shikiConfig: { theme: 'github-light' },
});
export async function renderMarkdown(markdown: string) {
  return (await (await processor).render(markdown)).code;
}
