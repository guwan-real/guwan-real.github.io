import source from '../../content/cs-review/handbook.md?raw';
import { renderMarkdownDocument } from './markdown';

let rendered: ReturnType<typeof renderMarkdownDocument> | undefined;
export const getHandbook = () => rendered ??= renderMarkdownDocument(source);
export { source as handbookSource };
