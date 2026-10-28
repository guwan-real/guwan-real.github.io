import { getCollection } from 'astro:content';
import { renderMarkdown } from './markdown';
import { validateCatalogue } from './content-schema';
import type { Answer, PublicQuestion } from './types';

const chunks = import.meta.glob<unknown[]>('../../content/cs-review/questions/*.json', { eager: true, import: 'default' });
let cache: ReturnType<typeof load> | undefined;
async function load() {
  const entries = await getCollection('csKnowledge');
  const { knowledge, questions } = validateCatalogue(entries.map((entry) => entry.data), Object.values(chunks).flat());
  for (const entry of entries) {
    if (entry.id !== entry.data.knowledgeId) throw new Error(`知识点文件名必须与 ID 一致：${entry.id}`);
  }
  return { entries, knowledge: knowledge.sort((a, b) => a.order - b.order), questions };
}
export const getReviewContent = () => import.meta.env.DEV ? load() : cache ??= load();

export async function getPublicQuestions(): Promise<PublicQuestion[]> {
  const { questions } = await getReviewContent();
  return Promise.all(questions.map(async (q) => ({
    id: q.id, revision: q.revision, moduleId: q.moduleId, knowledgeIds: q.knowledgeIds,
    type: q.type, stemHtml: await renderMarkdown(q.stem),
    options: await Promise.all(q.options.map(async (o) => ({ id: o.id, html: await renderMarkdown(o.text) }))),
    difficulty: q.difficulty, source: q.source, tags: q.tags,
  })));
}
export async function getAnswer(id: string): Promise<Answer> {
  const q = (await getReviewContent()).questions.find((q) => q.id === id);
  if (!q) throw new Error(`不存在的题目 ${id}`);
  return {
    id: q.id, revision: q.revision, correctOptionIds: q.correctOptionIds,
    analysisHtml: await renderMarkdown(q.explanation.analysis),
    stepsHtml: await Promise.all(q.explanation.steps.map(renderMarkdown)),
    keyPointHtml: await renderMarkdown(q.explanation.keyPoint),
    pitfallHtml: await renderMarkdown(q.explanation.pitfall),
    optionAnalysisHtml: q.explanation.optionAnalysis ? await Promise.all(q.options.map(async (option) => ({
      id: option.id, html: await renderMarkdown(q.explanation.optionAnalysis![option.id]),
    }))) : [],
  };
}
