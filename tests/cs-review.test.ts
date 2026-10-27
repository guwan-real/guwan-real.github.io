import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import matter from 'gray-matter';
import { questionSchema, validateCatalogue } from '../src/lib/cs-review/content-schema';
import { renderMarkdown } from '../src/lib/cs-review/markdown';
import { appendAttempt, createBackup, createSession, emptyStudyData, FutureVersionError, mergeStudyData, parseBackup, parseStudyData,
  questionStats, questionStatsIndex, recordExam, recordPracticeAnswer, sameOptions, setQuestionFlag, STORAGE_KEY, StudyStore } from '../src/lib/cs-review/study';
import type { Answer, Attempt, PublicQuestion, Question } from '../src/lib/cs-review/types';

const questionData: Question[] = JSON.parse(await readFile(new URL('../src/content/cs-review/questions/examples.json', import.meta.url), 'utf8'));
const knowledgeDirectory = new URL('../src/content/cs-review/knowledge/', import.meta.url);
const knowledgeData = await Promise.all((await readdir(knowledgeDirectory)).map(async (name) => matter(await readFile(new URL(name, knowledgeDirectory), 'utf8')).data));
const publicQuestions: PublicQuestion[] = questionData.map((q) => ({ id: q.id, revision: q.revision, moduleId: q.moduleId, knowledgeIds: q.knowledgeIds,
  type: q.type, stemHtml: q.stem, options: q.options.map((o) => ({ id: o.id, html: o.text })), difficulty: q.difficulty, source: q.source, tags: q.tags }));
const answers: Answer[] = questionData.map((q) => ({ id: q.id, revision: q.revision, correctOptionIds: q.correctOptionIds, analysisHtml: '', stepsHtml: [], keyPointHtml: '', pitfallHtml: '' }));
const t1 = '2026-10-27T01:00:00.000Z';
const t2 = '2026-10-27T02:00:00.000Z';
const t3 = '2026-10-27T03:00:00.000Z';
function study(mode: 'random' | 'exam' = 'random', questions = publicQuestions.slice(0, 1), id = 'session-one') {
  const data = emptyStudyData(); data.session = createSession(questions, mode, id, t1); return data;
}
function attempt(correct: boolean, time = t1, sessionId = 'history-one', questionId = publicQuestions[0].id): Attempt {
  return { id: `${sessionId}:${questionId}`, questionId, revision: 1, sessionId, mode: 'random', selectedOptionIds: [correct ? 'B' : 'A'], correct, answeredAt: time };
}
class MemoryStorage {
  value: string | null = null;
  blocked = false;
  quota = false;
  getItem(key: string) { assert.equal(key, STORAGE_KEY); if (this.blocked) throw new DOMException('blocked', 'SecurityError'); return this.value; }
  setItem(key: string, value: string) { assert.equal(key, STORAGE_KEY); if (this.quota) throw new DOMException('full', 'QuotaExceededError'); this.value = value; }
  removeItem(key: string) { assert.equal(key, STORAGE_KEY); this.value = null; }
}

test('the actual content catalogue is valid and example labels are explicit', () => {
  const result = validateCatalogue(knowledgeData, questionData);
  assert.equal(result.knowledge.length, 10); assert.equal(result.questions.length, 10);
  assert.ok(result.questions.every((q) => q.source.isExample && q.source.label.includes('非官方真题')));
  assert.ok(result.knowledge.every((k) => k.status === 'example'));
});
for (const [name, change] of [
  ['duplicate options', (q: Question) => { q.options[1].id = q.options[0].id; }],
  ['nonexistent answer', (q: Question) => { q.correctOptionIds = ['Z']; }],
  ['duplicate answers', (q: Question) => { q.correctOptionIds = ['B', 'B']; }],
  ['multiple answers in single choice', (q: Question) => { q.correctOptionIds = ['A', 'B']; }],
  ['reserved ID', (q: Question) => { q.id = 'constructor'; }],
  ['unsafe source URL', (q: Question) => { q.source.url = 'javascript:alert(1)'; }],
] as const) test(`content validation rejects ${name}`, () => {
  const q = structuredClone(questionData[0]); change(q); assert.equal(questionSchema.safeParse(q).success, false);
});
test('content validation rejects single-correct multiple choice and invalid boolean options', () => {
  const multiple = structuredClone(questionData.find((q) => q.type === 'multiple')!); multiple.correctOptionIds = ['A'];
  assert.equal(questionSchema.safeParse(multiple).success, false);
  const boolean = structuredClone(questionData.find((q) => q.type === 'boolean')!); boolean.options[0].id = 'A';
  assert.equal(questionSchema.safeParse(boolean).success, false);
});
test('content validation rejects duplicate question/knowledge IDs and broken/cross-module references', () => {
  assert.throws(() => validateCatalogue(knowledgeData, [...questionData, questionData[0]]), /重复/);
  assert.throws(() => validateCatalogue([...knowledgeData, knowledgeData[0]], questionData), /重复/);
  assert.throws(() => validateCatalogue(knowledgeData, [{ ...questionData[0], knowledgeIds: ['missing-topic'] }]), /不存在/);
  assert.throws(() => validateCatalogue(knowledgeData, [{ ...questionData[0], knowledgeIds: ['tcp-stream'] }]), /不一致/);
});
test('source links accept only HTTP(S)', () => {
  assert.equal(questionSchema.safeParse({ ...questionData[0], source: { ...questionData[0].source, url: 'https://example.com/source' } }).success, true);
});
test('set grading requires exact choices regardless of order', () => {
  assert.equal(sameOptions(['D', 'A', 'B'], ['A', 'B', 'D']), true);
  for (const selected of [[], ['A'], ['A', 'B'], ['A', 'B', 'C', 'D'], ['A', 'A', 'B']]) assert.equal(sameOptions(selected, ['A', 'B', 'D']), false);
});
test('practice submission records once, locks the result and survives serialization', () => {
  const data = study(); data.session!.selections[publicQuestions[0].id] = ['B'];
  recordPracticeAnswer(data, 'session-one', publicQuestions[0], answers[0], t2);
  recordPracticeAnswer(data, 'session-one', publicQuestions[0], answers[0], t3);
  assert.equal(data.attempts.length, 1); assert.equal(data.attempts[0].correct, true);
  assert.equal(data.session!.status, 'finished');
  assert.deepEqual(parseStudyData(JSON.parse(JSON.stringify(data))), data);
});
test('unselected practice cannot request a recorded answer', () => {
  const data = study(); assert.throws(() => recordPracticeAnswer(data, 'session-one', publicQuestions[0], answers[0], t2), /选择/);
  assert.equal(data.attempts.length, 0);
});
test('multiple choice and judgment grade using their actual answer sets', () => {
  for (const type of ['multiple', 'boolean']) {
    const index = publicQuestions.findIndex((q) => q.type === type); const q = publicQuestions[index];
    const data = study('random', [q]); data.session!.selections[q.id] = [...answers[index].correctOptionIds].reverse();
    recordPracticeAnswer(data, 'session-one', q, answers[index], t2); assert.equal(data.attempts[0].correct, true);
  }
});
test('one correct retry does not remove historical mistakes or mark mastery', () => {
  const data = emptyStudyData(); appendAttempt(data, attempt(false)); appendAttempt(data, attempt(true, t2, 'history-two'));
  const stats = questionStats(data, publicQuestions[0].id);
  assert.equal(stats.needsReview, true); assert.equal(stats.wrongCount, 1); assert.equal(stats.latest!.correct, true);
});
test('manual mastery retains history and a later wrong attempt reopens review', () => {
  const data = emptyStudyData(); appendAttempt(data, attempt(false));
  setQuestionFlag(data, publicQuestions[0].id, { masteredAt: t2, favorite: true, uncertain: true }, t2);
  assert.equal(questionStats(data, publicQuestions[0].id).needsReview, false);
  assert.equal(questionStats(data, publicQuestions[0].id).wrongCount, 1);
  appendAttempt(data, attempt(false, t3, 'history-three'));
  const stats = questionStats(data, publicQuestions[0].id);
  assert.equal(stats.needsReview, true); assert.equal(stats.wrongCount, 2); assert.equal(stats.favorite, true); assert.equal(stats.uncertain, true);
});
test('duplicate attempt IDs do not inflate counts', () => {
  const data = emptyStudyData(); appendAttempt(data, attempt(false)); appendAttempt(data, attempt(false)); assert.equal(data.attempts.length, 1);
});
test('statistics handle out-of-order imported history and flag-only questions', () => {
  const data = emptyStudyData();
  appendAttempt(data, attempt(false, t3)); appendAttempt(data, attempt(true, t1, 'history-two'));
  setQuestionFlag(data, publicQuestions[0].id, { masteredAt: t2 }, t2);
  setQuestionFlag(data, publicQuestions[1].id, { favorite: true }, t2);
  const index = questionStatsIndex(data);
  assert.equal(index.get(publicQuestions[0].id)!.latest!.answeredAt, t3);
  assert.equal(index.get(publicQuestions[0].id)!.needsReview, true);
  assert.equal(index.get(publicQuestions[1].id)!.attempts, 0);
  assert.equal(index.get(publicQuestions[1].id)!.favorite, true);
});
test('active exam persists selections without any grading', () => {
  const data = study('exam', publicQuestions); data.session!.selections[publicQuestions[0].id] = ['B']; data.session!.index = 4;
  const restored = parseStudyData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored.session!.selections, data.session!.selections); assert.equal(restored.attempts.length, 0); assert.equal(restored.session!.index, 4);
  assert.throws(() => recordPracticeAnswer(data, 'session-one', publicQuestions[0], answers[0]), /交卷/);
});
test('exam submission records every question atomically and counts unanswered as wrong', () => {
  const data = study('exam', publicQuestions); data.session!.selections[publicQuestions[0].id] = ['B'];
  recordExam(data, 'session-one', publicQuestions, answers, t2);
  assert.equal(data.attempts.length, 10); assert.equal(data.attempts.filter((a) => a.correct).length, 1);
  assert.equal(data.attempts.filter((a) => a.selectedOptionIds.length === 0).length, 9);
  assert.equal(data.session!.status, 'finished');
  recordExam(data, 'session-one', publicQuestions, answers, t3); assert.equal(data.attempts.length, 10);
  assert.deepEqual(parseStudyData(data), data);
});
test('incomplete or stale exam answer payloads cannot partially write results', () => {
  const data = study('exam', publicQuestions);
  assert.throws(() => recordExam(data, 'session-one', publicQuestions, answers.slice(0, -1)), /不完整/);
  assert.equal(data.attempts.length, 0); assert.equal(data.session!.status, 'active');
  const stale = structuredClone(answers); stale[3].revision = 9;
  assert.throws(() => recordExam(data, 'session-one', publicQuestions, stale), /版本/); assert.equal(data.attempts.length, 0);
});
test('stale ordinary answers and changed session IDs are rejected', () => {
  const data = study(); data.session!.selections[publicQuestions[0].id] = ['B'];
  assert.throws(() => recordPracticeAnswer(data, 'session-one', publicQuestions[0], { ...answers[0], revision: 5 }), /版本/);
  assert.throws(() => recordPracticeAnswer(data, 'other-session', publicQuestions[0], answers[0]), /替换/);
  assert.equal(data.attempts.length, 0);
});
test('backup roundtrip and repeated merge preserve totals and local session', () => {
  const local = study(); appendAttempt(local, attempt(false));
  const remote = emptyStudyData(); appendAttempt(remote, attempt(true, t2, 'history-two'));
  setQuestionFlag(remote, publicQuestions[0].id, { favorite: true }, t2); remote.reviewed['insertion-sort'] = t2;
  const backup = parseBackup(JSON.parse(JSON.stringify(createBackup(remote))));
  const merged = mergeStudyData(local, backup); const again = mergeStudyData(merged, backup);
  assert.equal(again.attempts.length, 2); assert.deepEqual(again.session, local.session); assert.equal(again.flags[publicQuestions[0].id].favorite, true);
  assert.equal(again.reviewed['insertion-sort'], t2);
});
test('backup merge keeps newer flags and rejects conflicting attempt contents', () => {
  const a = emptyStudyData(); const b = emptyStudyData();
  setQuestionFlag(a, publicQuestions[0].id, { favorite: false }, t3); setQuestionFlag(b, publicQuestions[0].id, { favorite: true }, t2);
  assert.equal(mergeStudyData(a, b).flags[publicQuestions[0].id].favorite, false);
  appendAttempt(a, attempt(false)); appendAttempt(b, attempt(true));
  assert.throws(() => mergeStudyData(a, b), /冲突/);
});
test('removed question history is retained in exported backups', () => {
  const data = emptyStudyData(); appendAttempt(data, attempt(false, t1, 'history-one', 'removed-question'));
  assert.equal(parseBackup(createBackup(data)).attempts[0].questionId, 'removed-question');
});
test('malformed imports and prototype pollution keys are rejected', () => {
  assert.throws(() => parseBackup({ version: 1 }), /导出/);
  assert.throws(() => parseStudyData({ ...emptyStudyData(), attempts: [{ ...attempt(false), correct: 'false' }] }), /不合法/);
  assert.throws(() => parseStudyData({ ...emptyStudyData(), attempts: [attempt(false), attempt(false)] }), /重复/);
  assert.throws(() => parseStudyData({ ...emptyStudyData(), flags: JSON.parse('{"__proto__":{}}') }), /不合法/);
  assert.throws(() => parseStudyData({ ...emptyStudyData(), reviewed: { constructor: t1 } }), /不合法/);
  assert.throws(() => parseStudyData({ ...emptyStudyData(), reviewed: { 'insertion-sort': 'bad-date' } }), /不合法/);
});
test('contradictory sessions and premature exam grades are rejected on restore', () => {
  const data = study('exam'); appendAttempt(data, { ...attempt(true, t1, 'session-one'), mode: 'exam' });
  assert.throws(() => parseStudyData(data), /提交数量/);
  const invalid = study(); invalid.session!.status = 'finished'; invalid.session!.submittedAt = t2;
  assert.throws(() => parseStudyData(invalid), /缺少/);
});
test('future data versions are explicitly rejected', () => {
  assert.throws(() => parseStudyData({ ...emptyStudyData(), version: 2 }), FutureVersionError);
});
test('storage reload persists progress and merges changes from another open page', async () => {
  const memory = new MemoryStorage(); const first = new StudyStore(memory); const second = new StudyStore(memory);
  await first.update((data) => { data.reviewed['insertion-sort'] = t1; });
  await second.update((data) => { data.reviewed['fifo-pages'] = t2; });
  const restored = new StudyStore(memory);
  assert.deepEqual(restored.snapshot().reviewed, { 'insertion-sort': t1, 'fifo-pages': t2 });
});
test('corrupt original storage is protected while new activity stays exportable in memory', async () => {
  const memory = new MemoryStorage(); memory.value = '{broken'; const store = new StudyStore(memory);
  assert.equal(store.state, 'corrupt'); await store.update((data) => { data.reviewed['insertion-sort'] = t1; });
  assert.equal(memory.value, '{broken'); assert.equal(store.snapshot().reviewed['insertion-sort'], t1);
});
test('future storage cannot be accidentally overwritten', async () => {
  const memory = new MemoryStorage(); memory.value = JSON.stringify({ version: 3, unknown: 'preserve' }); const raw = memory.value;
  const store = new StudyStore(memory); assert.equal(store.state, 'future');
  await store.update((data) => { data.reviewed['insertion-sort'] = t1; }); assert.equal(memory.value, raw);
});
test('unavailable storage and quota failures preserve exportable in-memory progress', async () => {
  const blocked = new StudyStore(null); assert.equal(blocked.state, 'unavailable');
  await blocked.update((data) => { data.reviewed['insertion-sort'] = t1; }); assert.equal(blocked.snapshot().reviewed['insertion-sort'], t1);
  const memory = new MemoryStorage(); const store = new StudyStore(memory); await store.update((data) => { data.reviewed['insertion-sort'] = t1; });
  const original = memory.value; memory.quota = true;
  await store.update((data) => { data.reviewed['fifo-pages'] = t2; });
  assert.equal(store.state, 'quota'); assert.equal(store.snapshot().reviewed['fifo-pages'], t2); assert.equal(memory.value, original);
  store.reload(); assert.equal(store.snapshot().reviewed['fifo-pages'], t2);
});
test('clearing touches only the module key and allows subsequent recovery', async () => {
  const memory = new MemoryStorage(); const store = new StudyStore(memory); await store.update((data) => { data.reviewed['insertion-sort'] = t1; });
  const backup = parseBackup(createBackup(store.snapshot())); await store.clear(); assert.equal(memory.value, null);
  await store.update((data) => Object.assign(data, mergeStudyData(data, backup))); assert.equal(store.snapshot().reviewed['insertion-sort'], t1);
});
test('a stale tab cannot edit a replaced practice session', async () => {
  const memory = new MemoryStorage(); const store = new StudyStore(memory); await store.update((data) => { data.session = study().session; });
  const second = new StudyStore(memory); await second.update((data) => { data.session = createSession(publicQuestions.slice(0, 1), 'random', 'other-session', t2); });
  await assert.rejects(() => store.sessionUpdate('session-one', (session) => { session.index = 0; }), /更换/);
  assert.equal(new StudyStore(memory).snapshot().session!.id, 'other-session');
});
test('Markdown renders math, tables and highlighted code while stripping active content', async () => {
  const html = await renderMarkdown('Inline $2^3=8$\n\n$$x^2$$\n\n```ts\nconst value = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))');
  assert.match(html, /class="katex/); assert.match(html, /<table>/); assert.match(html, /<pre/); assert.match(html, /<span style="color:/);
  assert.doesNotMatch(html, /<script|onerror|href="javascript:/);
});
