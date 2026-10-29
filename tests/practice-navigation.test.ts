import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextKnowledge, sessionKnowledge } from '../src/lib/cs-review/practice-navigation';
import { createBackup, createSession, emptyStudyData, parseBackup, parseStudyData, recordPracticeAnswer, StudyStore } from '../src/lib/cs-review/study';
import { captureLocal, mergeSyncDocuments, parseSyncDocument, seedSyncDocument } from '../src/lib/cs-review/sync-model';
import type { Answer, KnowledgeMeta, PublicQuestion } from '../src/lib/cs-review/types';

const time = '2026-10-29T02:00:00.000Z';
const later = '2026-10-29T02:01:00.000Z';
const topics: KnowledgeMeta[] = ['first-topic', 'second-topic', 'last-topic'].map((id, index) => ({
  knowledgeId: id, moduleId: index < 2 ? 'algorithms' : 'architecture', title: id,
  description: id, order: index + 1, status: 'handbook', source: '测试用内容', tags: ['测试'],
}));
const questions: PublicQuestion[] = ['first-question', 'second-question'].map((id) => ({
  id, revision: 1, moduleId: 'algorithms', knowledgeIds: ['first-topic'], type: 'single', stemHtml: id,
  options: [{ id: 'A', html: 'A' }, { id: 'B', html: 'B' }], difficulty: 'easy', source: { label: '测试', isExample: true }, tags: ['测试'],
}));
function study() {
  const data = emptyStudyData(); data.session = createSession(questions, 'knowledge', 'topic-session', time);
  data.session.knowledgeId = 'first-topic'; return data;
}

test('next topic follows syllabus order across modules and stops at the last topic', () => {
  const unsorted = [topics[2], topics[0], topics[1]];
  assert.equal(nextKnowledge('first-topic', unsorted)?.knowledgeId, 'second-topic');
  assert.equal(nextKnowledge('second-topic', unsorted)?.moduleId, 'architecture');
  assert.equal(nextKnowledge('last-topic', unsorted), undefined);
  assert.equal(nextKnowledge('missing-topic', unsorted), undefined);
  assert.deepEqual(unsorted.map((topic) => topic.knowledgeId), ['last-topic', 'first-topic', 'second-topic']);
});

test('legacy knowledge sessions infer a common topic without changing the saved record', () => {
  const data = study(); delete data.session!.knowledgeId;
  const before = structuredClone(data);
  assert.equal(sessionKnowledge(data.session!, questions, topics)?.knowledgeId, 'first-topic');
  assert.deepEqual(parseStudyData(data), before);
  assert.deepEqual(data, before);
});

test('ambiguous, mixed, removed or unrelated sessions never guess a next topic', () => {
  const session = study().session!; delete session.knowledgeId;
  const ambiguous = questions.map((q) => ({ ...q, knowledgeIds: ['first-topic', 'second-topic'] }));
  assert.equal(sessionKnowledge(session, ambiguous, topics), undefined);
  session.knowledgeId = 'second-topic';
  assert.equal(sessionKnowledge(session, ambiguous, topics)?.knowledgeId, 'second-topic');
  assert.equal(sessionKnowledge(session, questions, topics), undefined);
  delete session.knowledgeId;
  assert.equal(sessionKnowledge(session, [questions[0]], topics), undefined);
  assert.equal(sessionKnowledge(session, [questions[0], { ...questions[1], knowledgeIds: ['second-topic'] }], topics), undefined);
  session.mode = 'exam';
  assert.equal(sessionKnowledge(session, questions, topics), undefined);
});

test('topic, question position, selections and historical mistakes survive reload and backup', async () => {
  const data = study();
  data.session!.selections[questions[0].id] = ['B'];
  const answer: Answer = { id: questions[0].id, revision: 1, correctOptionIds: ['A'], analysisHtml: '', stepsHtml: [], keyPointHtml: '', pitfallHtml: '' };
  recordPracticeAnswer(data, data.session!.id, questions[0], answer, later);
  data.session!.index = 1; data.session!.selections[questions[1].id] = ['A'];
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  const store = new StudyStore(storage);
  await store.update((current) => Object.assign(current, data));
  const restored = new StudyStore(storage).snapshot();
  assert.deepEqual(restored, data);
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(createBackup(restored)))), data);
  assert.equal(restored.version, 1);
  assert.equal(sessionKnowledge(restored.session!, questions, topics)?.knowledgeId, 'first-topic');
});

test('invalid topic metadata is rejected while existing v1 sessions stay readable', () => {
  const data = study();
  assert.deepEqual(parseStudyData(data), data);
  data.session!.knowledgeId = '__proto__';
  assert.throws(() => parseStudyData(data), /知识点/);
  data.session!.knowledgeId = 'first-topic'; data.session!.mode = 'exam';
  assert.throws(() => parseStudyData(data), /知识点/);
});

test('sync retains topic context when another device still has a legacy session', () => {
  const current = seedSyncDocument(study());
  const legacy = structuredClone(current);
  delete legacy.data.session!.knowledgeId; delete legacy.sessions['topic-session'].session.knowledgeId;
  const moved = structuredClone(legacy.data); moved.session!.index = 1;
  const newerLegacy = captureLocal(legacy, moved, later);
  for (const [a, b] of [[current, newerLegacy], [newerLegacy, current]]) {
    const merged = parseSyncDocument(mergeSyncDocuments(a, b));
    assert.equal(merged.data.session!.knowledgeId, 'first-topic');
    assert.equal(merged.data.session!.index, 1);
    assert.equal(merged.sessions['topic-session'].session.knowledgeId, 'first-topic');
  }
});

test('sync rejects conflicting topic context rather than directing to an unrelated chapter', () => {
  const current = seedSyncDocument(study());
  const other = study(); other.session!.knowledgeId = 'second-topic';
  assert.throws(() => mergeSyncDocuments(current, seedSyncDocument(other)), /知识点冲突/);
});
