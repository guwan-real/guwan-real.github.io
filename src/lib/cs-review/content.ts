import { getCollection } from 'astro:content';
import { renderMarkdown } from './markdown';
import { validateCatalogue, validateExplanations, validatePaperReview } from './content-schema';
import type { Answer, PublicQuestion } from './types';
import paperDocuments from '../../content/cs-review/paper-sources.json';
import paperReview from '../../content/cs-review/paper-review-audit.json';

const chunks = import.meta.glob<unknown[]>('../../content/cs-review/questions/*.json', { eager: true, import: 'default' });
let cache: ReturnType<typeof load> | undefined;
async function load() {
  const [entries, explanations] = await Promise.all([getCollection('csKnowledge'), getCollection('csExplanations')]);
  const { knowledge, questions } = validateCatalogue(entries.map((entry) => entry.data), Object.values(chunks).flat());
  for (const entry of entries) {
    if (entry.id !== entry.data.knowledgeId) throw new Error(`知识点文件名必须与 ID 一致：${entry.id}`);
  }
  validateExplanations(knowledge, explanations.map((entry) => entry.data));
  for (const entry of explanations) {
    if (entry.id !== entry.data.knowledgeId) throw new Error(`扩展讲义文件名必须与 ID 一致：${entry.id}`);
  }
  const lessonDescriptions = new Map(explanations.map((entry) => [entry.data.knowledgeId, entry.data.description]));
  const enrichedKnowledge = knowledge.map((entry) => ({ ...entry, description: lessonDescriptions.get(entry.knowledgeId) ?? entry.description }));
  const papers = validatePaperReview(knowledge, questions, paperDocuments, paperReview);
  return { entries, explanations, knowledge: enrichedKnowledge.sort((a, b) => a.order - b.order), questions, paperDocuments: papers.documents, paperReview: papers.review };
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
