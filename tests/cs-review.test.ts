import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { questionSchema, validateCatalogue, validateExplanations } from '../src/lib/cs-review/content-schema';
import { renderMarkdown } from '../src/lib/cs-review/markdown';
import { parseHandbook, chapterBody } from '../src/lib/cs-review/handbook-source';
import syllabus from '../src/content/cs-review/syllabus.json';
import sourceManifest from '../src/content/cs-review/source-manifest.json';
import { appendAttempt, createBackup, createSession, emptyStudyData, FutureVersionError, mergeStudyData, parseBackup, parseStudyData,
  questionStats, questionStatsIndex, recordExam, recordPracticeAnswer, sameOptions, setQuestionFlag, STORAGE_KEY, StudyStore } from '../src/lib/cs-review/study';
import type { Answer, Attempt, PublicQuestion, Question } from '../src/lib/cs-review/types';

const questionData: Question[] = JSON.parse(await readFile(new URL('../src/content/cs-review/questions/examples.json', import.meta.url), 'utf8'));
const handbookQuestions: Question[] = JSON.parse(await readFile(new URL('../src/content/cs-review/questions/handbook-self-tests.json', import.meta.url), 'utf8'));
const expansionQuestions: Question[] = JSON.parse(await readFile(new URL('../src/content/cs-review/questions/review-expansion.json', import.meta.url), 'utf8'));
const questionDirectory = new URL('../src/content/cs-review/questions/', import.meta.url);
const allQuestions: Question[] = (await Promise.all((await readdir(questionDirectory)).filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(new URL(name, questionDirectory), 'utf8')) as Question[]))).flat();
const knowledgeDirectory = new URL('../src/content/cs-review/knowledge/', import.meta.url);
const knowledgeData = await Promise.all((await readdir(knowledgeDirectory)).map(async (name) => matter(await readFile(new URL(name, knowledgeDirectory), 'utf8')).data));
const explanationDirectory = new URL('../src/content/cs-review/explanations/', import.meta.url);
const explanations = await Promise.all((await readdir(explanationDirectory)).filter((name) => name.endsWith('.md')).map(async (name) => matter(await readFile(new URL(name, explanationDirectory), 'utf8'))));
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
  const result = validateCatalogue(knowledgeData, allQuestions);
  assert.equal(result.knowledge.length, 48); assert.equal(result.questions.length, allQuestions.length);
  assert.ok(result.questions.length > 130);
  assert.ok(result.questions.every((q) => q.source.isExample && q.source.label.includes('非官方真题')));
  assert.ok(result.knowledge.every((k) => k.status === 'handbook'));
});
test('authored lessons link to known topics and reject duplicate or orphan identities', () => {
  const { knowledge } = validateCatalogue(knowledgeData, allQuestions);
  const lessons = validateExplanations(knowledge, explanations.map((entry) => entry.data));
  assert.equal(lessons.length, 48);
  assert.throws(() => validateExplanations(knowledge, [lessons[0], lessons[0]]), /重复/);
  assert.throws(() => validateExplanations(knowledge, [{ ...lessons[0], knowledgeId: 'missing-topic' }]), /不存在/);
  assert.throws(() => validateExplanations(knowledge, [{ ...lessons[0], sources: [{ label: 'unsafe', url: 'javascript:alert(1)' }] }]));
});
test('each topic has worked teaching content and new practice with complete reasoning', () => {
  for (const topic of syllabus) {
    const lesson = explanations.find((entry) => entry.data.knowledgeId === topic.knowledgeId);
    assert.ok(lesson, `缺少基础讲义 ${topic.knowledgeId}`);
    assert.ok((lesson.content.match(/^## /gm)?.length ?? 0) >= 5, `${topic.knowledgeId} 缺少分节讲解`);
    const practice = allQuestions.filter((q) => q.id.startsWith(`foundation-${topic.knowledgeId}-`));
    assert.ok(practice.length >= 2, `${topic.knowledgeId} 缺少新增自测`);
    for (const q of practice) {
      assert.ok(q.explanation.steps.length >= 3);
      assert.deepEqual(Object.keys(q.explanation.optionAnalysis!).sort(), q.options.map((o) => o.id).sort());
    }
  }
});
test('expanded practice covers all 48 topics with complete per-option reasoning', () => {
  assert.equal(expansionQuestions.length, 72);
  for (const item of syllabus) assert.ok(expansionQuestions.some((q) => q.id === `review-extra-${String(item.number).padStart(2, '0')}` && q.knowledgeIds.includes(item.knowledgeId)));
  for (const q of expansionQuestions) {
    assert.deepEqual(Object.keys(q.explanation.optionAnalysis!).sort(), q.options.map((o) => o.id).sort());
    assert.ok(q.explanation.steps.length >= 3);
  }
});
test('per-option reasoning cannot omit or invent option IDs', () => {
  const incomplete = structuredClone(expansionQuestions[0]); delete incomplete.explanation.optionAnalysis!.A;
  assert.equal(questionSchema.safeParse(incomplete).success, false);
  const extra = structuredClone(expansionQuestions[0]); extra.explanation.optionAnalysis!.Z = '不存在的选项';
  assert.equal(questionSchema.safeParse(extra).success, false);
});
test('expanded numeric answers agree with independent timing and bit calculations', () => {
  const text = (id: string) => { const q = expansionQuestions.find((q) => q.id === id)!; return q.options.find((o) => q.correctOptionIds.includes(o.id))!.text; };
  assert.equal(text('review-extra-27'), `${0.95 * 110 + 0.05 * 210} ns`);
  assert.equal(text('review-extra-31'), `${1e8 * (0.8 + 0.2 * 4) / 2e9 * 1000} ms`);
  assert.equal(text('review-extra-32'), ((-5 >>> 0) & 0xffff).toString(2).padStart(16, '0'));
  assert.equal(text('review-extra-33'), `${2 + 0.05 * 80} ns`);
  assert.equal(text('review-extra-36'), `${2 ** 20 / 2 ** 12}`);
  assert.match(text('review-extra-37'), /4\/3/);
  const payload = 4020 - 20; const chunk = Math.floor((1500 - 20) / 8) * 8;
  assert.equal(text('review-drill-14'), `${chunk * 2 / 8}，${payload - chunk * 2 + 20} B`);
  assert.equal(text('review-drill-22'), `${Number((90 / (90 + 990) * 100).toFixed(2))}%`);
  assert.ok(Math.abs(Number(text('review-drill-23').replace('约 ', '')) - 80 / 110) < 0.0005);
});
test('sorting, LCS and FIFO/LRU walkthroughs agree with independent simulations', () => {
  const text = (id: string) => { const q = expansionQuestions.find((q) => q.id === id)!; return q.options.find((o) => q.correctOptionIds.includes(o.id))!.text; };
  const a = [7, 2, 6, 3, 5]; const pivot = a.at(-1)!; let i = -1;
  for (let j = 0; j < a.length - 1; j++) if (a[j] <= pivot) { i++; [a[i], a[j]] = [a[j], a[i]]; }
  [a[i + 1], a[a.length - 1]] = [a[a.length - 1], a[i + 1]];
  assert.equal(text('review-drill-01'), `[${a.join(',')}]`);
  const x = 'ABCBDAB', y = 'BDCABA'; const table = Array.from({ length: x.length + 1 }, () => Array<number>(y.length + 1).fill(0));
  for (let r = 1; r <= x.length; r++) for (let c = 1; c <= y.length; c++) table[r][c] = x[r - 1] === y[c - 1] ? table[r - 1][c - 1] + 1 : Math.max(table[r - 1][c], table[r][c - 1]);
  assert.equal(text('review-drill-04'), `${table[x.length][y.length]}`);
  const faults = (lru: boolean) => { const memory: number[] = []; let misses = 0;
    for (const page of [1, 2, 3, 1, 4, 1]) { const at = memory.indexOf(page); if (at < 0) { misses++; if (memory.length === 3) memory.shift(); memory.push(page); } else if (lru) memory.push(...memory.splice(at, 1)); }
    return misses;
  };
  assert.equal(text('review-drill-09'), `${faults(false)}，${faults(true)}`);
});
test('unanswered exam submissions remain wrong but do not count as answered practice', () => {
  const data = emptyStudyData(); const blank = attempt(false); blank.selectedOptionIds = [];
  appendAttempt(data, blank);
  assert.equal(questionStats(data, blank.questionId).answeredCount, 0);
  assert.equal(questionStatsIndex(data).get(blank.questionId)!.needsReview, true);
  appendAttempt(data, attempt(true, t2, 'later'));
  assert.equal(questionStats(data, blank.questionId).answeredCount, 1);
  assert.deepEqual(questionStatsIndex(data).get(blank.questionId), questionStats(data, blank.questionId));
  assert.equal(questionStats(data, blank.questionId).wrongCount, 1);
});
test('all 48 syllabus items have their own chapter and handbook self-test', () => {
  assert.deepEqual(syllabus.map((item) => item.number), Array.from({ length: 48 }, (_, i) => i + 1));
  for (const item of syllabus) {
    const chapter = knowledgeData.find((k) => k.knowledgeId === item.knowledgeId)!;
    assert.equal(chapter.moduleId, item.moduleId); assert.equal(chapter.syllabusNumber, item.number);
    const question = handbookQuestions.find((q) => q.id === `handbook-${String(item.number).padStart(2, '0')}`)!;
    assert.ok(question); assert.deepEqual(question.knowledgeIds, [item.knowledgeId]);
    assert.ok(question.source.label.includes(`第 ${item.number} 节`) && question.source.isExample);
  }
});
test('chapter imports retain every source section and all 24 specialist recipes', async () => {
  const source = await readFile(new URL('../src/content/cs-review/handbook.md', import.meta.url), 'utf8');
  const { sections, recipes } = parseHandbook(source);
  assert.equal(sections.size, 48); assert.equal(recipes.size, 24);
  assert.deepEqual([...new Set(syllabus.flatMap((item) => item.recipes))].sort(), [...recipes.keys()].sort());
  for (const item of syllabus) {
    const document = matter(await readFile(new URL(`${item.knowledgeId}.md`, knowledgeDirectory), 'utf8'));
    assert.equal(document.content.trim(), chapterBody(sections.get(item.number)!, item.recipes.map((id) => recipes.get(id)!)).trim());
  }
});
test('archived handbook and syllabus retain their original bytes', async () => {
  const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  assert.equal(hash(await readFile(new URL('../src/content/cs-review/handbook.md', import.meta.url))), sourceManifest.handbookSha256);
  assert.equal(hash(await readFile(new URL('../public/appendix/cs-review/resources/sgcc-2027-computer-syllabus.pdf', import.meta.url))), sourceManifest.syllabusSha256);
});
test('numeric self-tests agree with independently recomputed results', () => {
  const answerText = (number: number) => {
    const q = handbookQuestions.find((q) => q.id === `handbook-${String(number).padStart(2, '0')}`)!;
    return q.options.find((option) => option.id === q.correctOptionIds[0])!.text;
  };
  let remainder = parseInt('1101' + '000', 2);
  const divisor = parseInt('1011', 2);
  for (let bit = 6; bit >= 3; bit--) if (remainder & (1 << bit)) remainder ^= divisor << (bit - 3);
  assert.equal(answerText(19), remainder.toString(2).padStart(3, '0'));
  assert.equal(answerText(27).toLowerCase(), `0x${(9 * 1024 + (0x12a3 % 1024)).toString(16)}`);
  assert.equal(answerText(32), String(0x90 - 256).replace('-', '−'));
  assert.equal(answerText(35), `${(5 + 20 - 1)} ns`);
  assert.equal(Number(answerText(37)), 1 / (0.2 + 0.8 / 4));
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
