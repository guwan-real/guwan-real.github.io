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

// Keep authored lessons separate from the byte-preserved handbook imports.
export const explanationSchema = z.object({
  knowledgeId: stableId,
  description: text,
  updatedAt: z.iso.date(),
  sources: z.array(z.object({ label: text, url: z.url().refine((url) => /^https:\/\//i.test(url), '参考资料只接受 HTTPS 链接') })).min(1),
});
export type ExplanationMeta = z.infer<typeof explanationSchema>;

export const paperDocumentSchema = z.object({
  id: stableId,
  fileName: text,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(['pdf', 'docx', 'doc']),
  documentType: z.enum(['compiled-paper', 'recollection', 'answer-notes', 'compilation', 'professional-title-bank']),
  verification: z.literal('unverified'),
  extraction: z.enum(['text', 'ocr', 'word']),
  claimedYear: z.number().int().min(1900).max(2100).optional(),
  pages: z.number().int().positive().optional(),
  sameQuestionSetAs: stableId.optional(),
  note: text,
}).refine((document) => document.format !== 'pdf' || document.pages !== undefined, 'PDF 来源必须记录页数');
export type PaperDocument = z.infer<typeof paperDocumentSchema>;
const paperEvidenceSchema = z.object({ documentId: stableId, locator: text });
export const paperReviewSchema = z.object({
  reviewedAt: z.iso.date(),
  gaps: z.array(z.object({ id: stableId, knowledgeId: stableId, topic: text, summary: text, evidence: z.array(paperEvidenceSchema).min(1), questionIds: z.array(stableId).min(1) })),
  sourceIssues: z.array(z.object({ id: stableId, documentId: stableId, locator: text, issue: text, resolution: text })),
  exclusions: z.array(text),
});

export function validateExplanations(knowledge: KnowledgeMeta[], input: unknown[]) {
  const explanations = input.map((entry) => explanationSchema.parse(entry));
  const ids = new Set(knowledge.map((entry) => entry.knowledgeId));
  const seen = new Set<string>();
  for (const entry of explanations) {
    if (!ids.has(entry.knowledgeId)) throw new Error(`扩展讲义关联了不存在的知识点：${entry.knowledgeId}`);
    if (seen.has(entry.knowledgeId)) throw new Error(`扩展讲义 ID 重复：${entry.knowledgeId}`);
    seen.add(entry.knowledgeId);
  }
  return explanations;
}

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
  source: z.object({
    label: text, url: z.url().refine((url) => /^https?:\/\//i.test(url), '来源链接仅支持 HTTP(S)').optional(), isExample: z.boolean(),
    reference: paperEvidenceSchema.extend({ kind: z.enum(['adapted', 'transcribed']) }).optional(),
  }),
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

export function validatePaperReview(knowledge: KnowledgeMeta[], questions: Question[], documentInput: unknown[], reviewInput: unknown) {
  const documents = documentInput.map((document) => paperDocumentSchema.parse(document));
  const review = paperReviewSchema.parse(reviewInput);
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  if (documentMap.size !== documents.length) throw new Error('资料来源 ID 重复');
  const locate = (evidence: z.infer<typeof paperEvidenceSchema>) => {
    const document = documentMap.get(evidence.documentId);
    if (!document) throw new Error(`引用不存在的资料：${evidence.documentId}`);
    if (document.format === 'pdf') {
      const pages = [...evidence.locator.matchAll(/(\d+)\s*页/g)].map((match) => Number(match[1]));
      if (!pages.length || pages.some((page) => page < 1 || page > document.pages!)) throw new Error(`资料页码超出范围或缺失：${evidence.documentId} ${evidence.locator}`);
    }
  };
  for (const document of documents) {
    if (document.sameQuestionSetAs && (document.sameQuestionSetAs === document.id || !documentMap.has(document.sameQuestionSetAs))) throw new Error(`重复题组引用无效：${document.id}`);
  }
  for (const q of questions) {
    if (!q.source.reference) continue;
    locate(q.source.reference);
    if (q.source.isExample !== (q.source.reference.kind === 'adapted')) throw new Error(`题目改编标识与来源不符：${q.id}`);
  }
  const topicIds = new Set(knowledge.map((topic) => topic.knowledgeId));
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const recordIds = new Set<string>();
  for (const gap of review.gaps) {
    if (!topicIds.has(gap.knowledgeId)) throw new Error(`资料补充关联未知知识点：${gap.knowledgeId}`);
    if (recordIds.has(gap.id)) throw new Error(`资料审阅记录 ID 重复：${gap.id}`);
    recordIds.add(gap.id);
    gap.evidence.forEach(locate);
    for (const id of gap.questionIds) {
      if (!questionMap.get(id)?.knowledgeIds.includes(gap.knowledgeId)) throw new Error(`资料补充题目关联错误：${id}`);
    }
  }
  for (const issue of review.sourceIssues) {
    if (recordIds.has(issue.id)) throw new Error(`资料审阅记录 ID 重复：${issue.id}`);
    recordIds.add(issue.id);
    locate(issue);
  }
  return { documents, review };
}

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
