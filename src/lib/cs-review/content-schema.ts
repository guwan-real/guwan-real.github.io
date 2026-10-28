import { z } from 'zod';
import { MODULE_IDS } from './catalogue';

const stableId = z.string().max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).refine((id) => !['constructor', 'prototype', '__proto__'].includes(id), '不可使用保留标识符');
const text = z.string().trim().min(1);
export const knowledgeSchema = z.object({
  knowledgeId: stableId,
  moduleId: z.enum(MODULE_IDS),
  title: text,
  description: text,
  order: z.number().int().nonnegative(),
  status: z.enum(['example', 'handbook']),
  syllabusNumber: z.number().int().min(1).max(48).optional(),
  source: text,
  tags: z.array(text).min(1),
});
export type KnowledgeMeta = z.infer<typeof knowledgeSchema>;

export const questionSchema = z.object({
  id: stableId,
  revision: z.number().int().positive(),
  moduleId: z.enum(MODULE_IDS),
  knowledgeIds: z.array(stableId).min(1),
  type: z.enum(['single', 'multiple', 'boolean']),
  stem: text,
  options: z.array(z.object({ id: z.string().regex(/^[A-Z]$/), text })).min(2).max(12),
  correctOptionIds: z.array(z.string().regex(/^[A-Z]$/)).min(1),
  explanation: z.object({
    analysis: text,
    steps: z.array(text),
    keyPoint: text,
    pitfall: text,
    optionAnalysis: z.record(z.string().regex(/^[A-Z]$/), text).optional(),
  }),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  source: z.object({ label: text, url: z.url().refine((url) => /^https?:\/\//i.test(url), '来源链接仅支持 HTTP(S)').optional(), isExample: z.boolean() }),
  tags: z.array(text).min(1),
}).superRefine((q, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: 'custom', message });
  const optionIds = new Set(q.options.map((o) => o.id));
  if (optionIds.size !== q.options.length) add('选项 ID 重复');
  if (new Set(q.correctOptionIds).size !== q.correctOptionIds.length) add('答案 ID 重复');
  if (q.correctOptionIds.some((id) => !optionIds.has(id))) add('答案必须属于现有选项');
  if (q.type !== 'multiple' && q.correctOptionIds.length !== 1) add('单选题和判断题必须只有一个答案');
  if (q.type === 'multiple' && q.correctOptionIds.length < 2) add('多选题必须至少有两个正确选项');
  if (q.type === 'boolean' && (q.options.length !== 2 || !optionIds.has('T') || !optionIds.has('F'))) add('判断题选项必须为 T 和 F');
  if (new Set(q.knowledgeIds).size !== q.knowledgeIds.length) add('关联知识点重复');
  if (q.explanation.optionAnalysis && (Object.keys(q.explanation.optionAnalysis).length !== optionIds.size
    || [...optionIds].some((id) => !q.explanation.optionAnalysis?.[id]))) add('逐项解析必须恰好覆盖所有选项');
});
export type Question = z.infer<typeof questionSchema>;

export function validateCatalogue(knowledgeInput: unknown[], questionInput: unknown[]) {
  const knowledge = knowledgeInput.map((k) => knowledgeSchema.parse(k));
  const questions = questionInput.map((q) => questionSchema.parse(q));
  const assertUnique = (ids: string[], kind: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`${kind} ID 重复`);
  };
  assertUnique(knowledge.map((k) => k.knowledgeId), '知识点');
  assertUnique(questions.map((q) => q.id), '题目');
  const index = new Map(knowledge.map((k) => [k.knowledgeId, k]));
  for (const question of questions) {
    for (const id of question.knowledgeIds) {
      const linked = index.get(id);
      if (!linked) throw new Error(`${question.id} 关联了不存在的知识点 ${id}`);
      if (linked.moduleId !== question.moduleId) throw new Error(`${question.id} 与知识点 ${id} 的所属模块不一致`);
    }
  }
  return { knowledge, questions };
}
