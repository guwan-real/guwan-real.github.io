import { escapeHtml as e, fetchJson } from './browser';
import { moduleTitle } from './catalogue';
interface SearchEntry { id: string; moduleId: string; title: string; description: string; text: string }
export function initSearch(url: (path: string) => string, notify: (message: string) => void) {
  const input = document.querySelector<HTMLInputElement>('[data-knowledge-search]')!;
  const directory = document.querySelector<HTMLElement>('[data-knowledge-directory]')!;
  const results = document.querySelector<HTMLElement>('#knowledge-search-results')!;
  let index: Promise<SearchEntry[]> | undefined;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout>;
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  function highlight(value: string, tokens: string[]) {
    const token = tokens.find((token) => normalize(value).includes(token));
    if (!token) return e(value);
    const start = normalize(value).indexOf(token);
    return `${e(value.slice(0, start))}<mark>${e(value.slice(start, start + token.length))}</mark>${e(value.slice(start + token.length))}`;
  }
  async function search() {
    const current = ++generation;
    const query = input.value.trim().slice(0, 120);
    results.hidden = !query; directory.hidden = Boolean(query);
    if (!query) return;
    results.innerHTML = '<p class="review-caption">正在搜索全文…</p>';
    try {
      index ??= fetchJson<SearchEntry[]>(url('data/search.json')).catch((error) => { index = undefined; throw error; });
      const entries = await index;
      if (current !== generation) return;
      const tokens = normalize(query).split(/\s+/).filter(Boolean);
      const matches = entries.filter((entry) => tokens.every((token) => normalize(`${entry.title} ${entry.description} ${entry.text}`).includes(token)));
      results.innerHTML = `<p class="review-caption">找到 ${matches.length} 个知识点 · 搜索范围包括标题与正文</p>` + matches.map((entry) => {
        const at = Math.max(0, tokens.map((token) => normalize(entry.text).indexOf(token)).find((position) => position >= 0) ?? 0);
        const snippet = entry.text.slice(Math.max(0, at - 35), at + 130).replace(/\s+/g, ' ');
        return `<a class="review-search-result" href="${url(`knowledge/${entry.id}/`)}"><span class="review-label">${e(moduleTitle(entry.moduleId))}</span><h3>${highlight(entry.title, tokens)}</h3><p>${highlight(snippet, tokens)}…</p></a>`;
      }).join('') + (matches.length ? '' : '<p class="review-muted">试试更短的关键词，或返回目录。完整手册尚待接入。</p>');
    } catch (error) { results.innerHTML = '<p class="review-muted">搜索暂不可用，仍可从章节目录阅读。</p>'; notify(error instanceof Error ? error.message : '搜索失败。'); }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => void search(), 120); });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); input.focus(); }
  });
}
