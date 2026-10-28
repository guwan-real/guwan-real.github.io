import type { StudyStore } from './study';
import type { Answer, KnowledgeMeta, PublicQuestion } from './types';

export interface ReviewContext {
  store: StudyStore;
  questions: PublicQuestion[];
  knowledge: KnowledgeMeta[];
  url: (path?: string) => string;
  notify: (message: string, success?: boolean) => void;
  confirm: (title: string, message: string, label: string) => Promise<boolean>;
  beforeClear?: () => void;
}
export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const pluralCount = (count: number, unit: string) => `${count} ${unit}`;
export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '尚无记录';
}
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
  if (!response.ok) throw new Error('内容暂时无法加载，请检查网络后重试。你的已保存记录不会改变。');
  return response.json() as Promise<T>;
}
const answerCache = new Map<string, Answer>();
export async function fetchAnswer(context: ReviewContext, question: PublicQuestion): Promise<Answer> {
  const key = `${question.id}:${question.revision}`;
  if (answerCache.has(key)) return answerCache.get(key)!;
  const answer = await fetchJson<Answer>(context.url(`data/answers/${question.id}.json?v=${question.revision}`));
  if (answer.id !== question.id || answer.revision !== question.revision || !Array.isArray(answer.correctOptionIds) || !answer.correctOptionIds.length
    || answer.correctOptionIds.some((id) => !question.options.some((o) => o.id === id))) {
    throw new Error('题目与答案版本不一致，请刷新页面后重试。当前作答已保留。');
  }
  answerCache.set(key, answer);
  return answer;
}
export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function preserveFocus(container: HTMLElement, render: () => void) {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
  render();
  if (active) Array.from(container.querySelectorAll<HTMLElement>('[data-focus]')).find((el) => el.dataset.focus === active)?.focus({ preventScroll: true });
}
