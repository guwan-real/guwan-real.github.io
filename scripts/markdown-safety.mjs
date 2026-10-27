import { defaultSchema } from 'rehype-sanitize';

// Only Markdown is accepted. Remove raw HTML before trusted KaTeX/Shiki generate their markup.
export function remarkNoRawHtml() {
  return (tree) => {
    const walk = (node) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.filter((child) => child.type !== 'html');
      node.children.forEach(walk);
    };
    walk(tree);
  };
}
export const reviewSanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/, 'math-inline', 'math-display']],
    pre: [...(defaultSchema.attributes?.pre ?? []), 'style', 'tabIndex', 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'style', 'className'],
  },
};
