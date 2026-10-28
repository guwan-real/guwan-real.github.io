import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import { validateCatalogue, validatePaperReview } from '../src/lib/cs-review/content-schema';
import documents from '../src/content/cs-review/paper-sources.json';
import review from '../src/content/cs-review/paper-review-audit.json';

const knowledgeRoot = new URL('../src/content/cs-review/knowledge/', import.meta.url);
const questionRoot = new URL('../src/content/cs-review/questions/', import.meta.url);
const knowledgeInput = await Promise.all((await readdir(knowledgeRoot)).filter((name) => name.endsWith('.md')).map(async (name) => matter(await readFile(new URL(name, knowledgeRoot), 'utf8')).data));
const questionInput = (await Promise.all((await readdir(questionRoot)).filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(new URL(name, questionRoot), 'utf8')) as unknown[]))).flat();
const { knowledge, questions } = validateCatalogue(knowledgeInput, questionInput);
const emptyReview = { reviewedAt: '2026-10-28', gaps: [], sourceIssues: [], exclusions: [] };

test('local paper registry records files rather than claiming verified official exams', () => {
  const result = validatePaperReview(knowledge, questions, documents, review);
  assert.equal(result.documents.length, 21);
  assert.equal(result.documents.reduce((sum, document) => sum + (document.pages ?? 0), 0), 322);
  assert.equal(result.documents.filter((document) => document.extraction === 'ocr').reduce((sum, document) => sum + (document.pages ?? 0), 0), 57);
  assert.ok(result.documents.every((document) => document.verification === 'unverified'));
  assert.ok(result.documents.some((document) => document.sameQuestionSetAs));
  assert.doesNotMatch(JSON.stringify([documents, review]), /\/Users\/|github_pat_/);
});

test('each paper-derived exercise has checked provenance and is included in its topic audit', () => {
  validatePaperReview(knowledge, questions, documents, review);
  const derived = questions.filter((question) => question.id.startsWith('paper-review-'));
  assert.ok(derived.length > 0);
  for (const question of derived) {
    assert.equal(question.source.reference?.kind, 'adapted');
    assert.equal(question.source.isExample, true);
    assert.match(question.source.label, /改编/);
    assert.match(question.source.label, /非官方真题/);
    assert.ok(question.explanation.steps.length >= 3);
    assert.deepEqual(Object.keys(question.explanation.optionAnalysis!).sort(), question.options.map((option) => option.id).sort());
    assert.ok(review.gaps.some((gap) => gap.questionIds.includes(question.id) && question.knowledgeIds.includes(gap.knowledgeId)), `${question.id}: missing audit`);
  }
});

test('unknown documents, missing or out-of-range pages and misleading adaptation flags are rejected', () => {
  const sample = structuredClone(questions[0]);
  const doc = documents.find((document) => document.format === 'pdf')!;
  sample.source.reference = { documentId: doc.id, locator: 'PDF 第 1 页，第 1 题', kind: 'adapted' };
  sample.source.isExample = true;
  assert.doesNotThrow(() => validatePaperReview(knowledge, [sample], documents, emptyReview));
  for (const reference of [
    { ...sample.source.reference, documentId: 'missing-source' },
    { ...sample.source.reference, locator: 'PDF 第 9999 页' },
    { ...sample.source.reference, locator: 'PDF 第 0 页' },
    { ...sample.source.reference, locator: '没有页码' },
  ]) assert.throws(() => validatePaperReview(knowledge, [{ ...sample, source: { ...sample.source, reference } }], documents, emptyReview));
  assert.throws(() => validatePaperReview(knowledge, [{ ...sample, source: { ...sample.source, isExample: false } }], documents, emptyReview));
  assert.throws(() => validatePaperReview(knowledge, [], [documents[0], documents[0]], emptyReview), /重复/);
  assert.throws(() => validatePaperReview(knowledge, [], [{ ...documents[0], sameQuestionSetAs: documents[0].id }], emptyReview), /无效/);
});

test('audit topic links cannot silently point at absent or unrelated questions', () => {
  const question = questions[0]; const doc = documents.find((document) => document.format === 'pdf')!;
  const gap = { id: 'paper-gap-test', knowledgeId: question.knowledgeIds[0], topic: '测试', summary: '用于验证关联边界', evidence: [{ documentId: doc.id, locator: 'PDF 第 1 页' }], questionIds: [question.id] };
  assert.doesNotThrow(() => validatePaperReview(knowledge, questions, documents, { ...emptyReview, gaps: [gap] }));
  assert.throws(() => validatePaperReview(knowledge, questions, documents, { ...emptyReview, gaps: [{ ...gap, questionIds: ['missing-question'] }] }), /关联错误/);
  const otherTopic = knowledge.find((topic) => !question.knowledgeIds.includes(topic.knowledgeId))!;
  assert.throws(() => validatePaperReview(knowledge, questions, documents, { ...emptyReview, gaps: [{ ...gap, knowledgeId: otherTopic.knowledgeId }] }), /关联错误/);
});
