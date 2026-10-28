import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonical, captureLocal, mergeSyncDocuments, nextSyncTime, parseSyncDocument, seedSyncDocument } from '../src/lib/cs-review/sync-model';
import { createSession, emptyStudyData, masteryTimestamp, parseStudyData, questionStats, recordExam, recordPracticeAnswer, setQuestionFlag, STORAGE_KEY, StudyStore } from '../src/lib/cs-review/study';
import { decodeUtf8, encodeUtf8, GitHubSyncClient, SyncError, validateConnection } from '../src/lib/cs-review/github-api';
import { cacheKey, StudySyncEngine } from '../src/lib/cs-review/sync-engine';
import type { Answer, PublicQuestion, Question, StudyData } from '../src/lib/cs-review/types';
import type { SyncDocument } from '../src/lib/cs-review/sync-model';

const source: Question[] = JSON.parse(await readFile(new URL('../src/content/cs-review/questions/examples.json', import.meta.url), 'utf8'));
const questions: PublicQuestion[] = source.slice(0, 3).map((q) => ({ id: q.id, revision: q.revision, moduleId: q.moduleId, knowledgeIds: q.knowledgeIds, type: q.type, stemHtml: q.stem,
  options: q.options.map((o) => ({ id: o.id, html: o.text })), difficulty: q.difficulty, source: q.source, tags: q.tags }));
const answers: Answer[] = source.slice(0, 3).map((q) => ({ id: q.id, revision: q.revision, correctOptionIds: q.correctOptionIds, analysisHtml: '', stepsHtml: [], keyPointHtml: '', pitfallHtml: '' }));
const t = (i: number) => `2026-10-28T02:${String(i).padStart(2, '0')}:00.000Z`;
const connection = { owner: 'guwan-real', repo: 'cs-review-records', token: `github_pat_${'test_only_not_a_real_secret_'.repeat(2)}` };
function start(id = 'shared', exam = false) { const data = emptyStudyData(); data.session = createSession(questions, exam ? 'exam' : 'random', id, t(0)); return data; }
function answer(data: StudyData, index = 0, correct = true, at = t(1)) {
  const q = questions[index]; data.session!.selections[q.id] = correct ? answers[index].correctOptionIds : [q.options.find((o) => !answers[index].correctOptionIds.includes(o.id))!.id];
  recordPracticeAnswer(data, data.session!.id, q, answers[index], at);
}
function change(doc: SyncDocument, fn: (data: StudyData) => void, at: string) { const data = structuredClone(doc.data); fn(data); return captureLocal(doc, data, at); }
class MemoryStorage {
  records = new Map<string, string>(); blocked = false;
  getItem(key: string) { return this.records.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.blocked) throw new DOMException('full', 'QuotaExceededError'); this.records.set(key, value); }
  removeItem(key: string) { this.records.delete(key); }
}
class Backend {
  value: SyncDocument | null = null; sequence = 1; writes = 0; private = true;
  beforeWrite?: () => void | Promise<void>; conflict = false;
  sha() { return this.sequence.toString(16).padStart(40, '0'); }
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://api.github.com');
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${connection.token}`);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    if (url.pathname.endsWith('/cs-review-records')) return Response.json({ private: this.private, default_branch: 'main', archived: false });
    if (init?.method === 'PUT') {
      this.writes++; if (this.beforeWrite) { const hook = this.beforeWrite; this.beforeWrite = undefined; await hook(); }
      const body = JSON.parse(String(init.body));
      if (this.conflict || (this.value && body.sha !== this.sha()) || (!this.value && body.sha)) { this.conflict = false; return Response.json({}, { status: 409 }); }
      assert.equal(body.branch, 'main'); this.value = parseSyncDocument(JSON.parse(decodeUtf8(body.content))); this.sequence++;
      return Response.json({ content: { sha: this.sha() } });
    }
    if (!this.value) return Response.json({}, { status: 404 });
    return Response.json({ type: 'file', size: canonical(this.value).length, sha: this.sha(), encoding: 'base64', content: encodeUtf8(canonical(this.value)) });
  }) as typeof fetch;
  client() { return new GitHubSyncClient(connection, this.fetch); }
}
function setup(data = start()) { const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, JSON.stringify(data)); const store = new StudyStore(storage); return { storage, store, engine: new StudySyncEngine(store, storage, cacheKey(connection.owner, connection.repo)) }; }

test('existing v1 records seed into versioned sync without changing original data', () => {
  const data = start(); answer(data); setQuestionFlag(data, questions[0].id, { favorite: true }, t(2)); data.reviewed['insertion-sort'] = t(2);
  const seeded = seedSyncDocument(data); assert.deepEqual(parseSyncDocument(JSON.parse(JSON.stringify(seeded))).data, data); assert.equal(data.version, 1);
  const unsafe = { ...seeded, token: connection.token }; assert.ok(!JSON.stringify(parseSyncDocument(unsafe)).includes(connection.token));
});
test('separate offline sessions retain both histories and every unfinished session', () => {
  const a = start('phone'), b = start('computer'); answer(a, 0, true, t(1)); answer(b, 1, false, t(2));
  const merged = mergeSyncDocuments(seedSyncDocument(a), seedSyncDocument(b));
  assert.equal(merged.data.attempts.length, 2); assert.equal(merged.data.session!.id, 'computer'); assert.equal(Object.keys(merged.sessions).length, 2);
  assert.deepEqual(mergeSyncDocuments(merged, seedSyncDocument(a)), merged);
});
test('same-session answers to different questions merge without dropping selections', () => {
  const base = seedSyncDocument(start()); const a = change(base, (d) => answer(d, 0, true, t(1)), t(1)); const b = change(base, (d) => answer(d, 1, true, t(2)), t(2));
  const merged = mergeSyncDocuments(a, b); assert.equal(merged.data.attempts.length, 2); assert.equal(merged.data.session!.committed.length, 2);
  assert.deepEqual(merged.data.session!.selections[questions[0].id], answers[0].correctOptionIds); assert.deepEqual(merged.data.session!.selections[questions[1].id], answers[1].correctOptionIds);
  assert.equal(canonical(mergeSyncDocuments(b, a)), canonical(merged));
});
test('conflicting offline submissions preserve both results and converge idempotently', () => {
  const base = seedSyncDocument(start()); const a = change(base, (d) => answer(d, 0, false, t(1)), t(1)); const b = change(base, (d) => answer(d, 0, true, t(2)), t(2));
  const merged = mergeSyncDocuments(a, b); assert.equal(merged.data.attempts.length, 2); assert.equal(questionStats(merged.data, questions[0].id).wrongCount, 1);
  assert.equal(questionStats(merged.data, questions[0].id).needsReview, true); assert.deepEqual(merged.data.session!.selections[questions[0].id], answers[0].correctOptionIds);
  assert.equal(canonical(mergeSyncDocuments(b, a)), canonical(merged));
  assert.equal(canonical(mergeSyncDocuments(mergeSyncDocuments(merged, a), b)), canonical(merged));
});
test('same logical submission made twice with the same choices is counted once', () => {
  const base = seedSyncDocument(start()); const a = change(base, (d) => answer(d, 0, true, t(1)), t(1)), b = change(base, (d) => answer(d, 0, true, t(2)), t(2));
  assert.equal(mergeSyncDocuments(a, b).data.attempts.length, 1);
});
test('independent favorite and uncertain edits both survive; removal propagates', () => {
  const data = start(); setQuestionFlag(data, questions[0].id, {}, t(0)); const base = seedSyncDocument(data);
  const a = change(base, (d) => setQuestionFlag(d, questions[0].id, { favorite: true }, t(1)), t(1));
  const b = change(base, (d) => setQuestionFlag(d, questions[0].id, { uncertain: true }, t(2)), t(2));
  const merged = mergeSyncDocuments(a, b); assert.equal(merged.data.flags[questions[0].id].favorite, true); assert.equal(merged.data.flags[questions[0].id].uncertain, true);
  const removed = change(merged, (d) => setQuestionFlag(d, questions[0].id, { favorite: false }, t(3)), t(3));
  assert.equal(mergeSyncDocuments(removed, a).data.flags[questions[0].id].favorite, false);
});
test('unmarking reviewed creates a tombstone so older devices cannot resurrect it', () => {
  const data = start(); data.reviewed['insertion-sort'] = t(1); const base = seedSyncDocument(data);
  const removed = change(base, (d) => { delete d.reviewed['insertion-sort']; }, t(2));
  const merged = mergeSyncDocuments(base, removed); assert.equal(merged.data.reviewed['insertion-sort'], undefined); assert.equal(merged.reviewChanges['insertion-sort'].value, null);
  assert.equal(canonical(mergeSyncDocuments(merged, base)), canonical(merged));
});
test('later wrong results reopen manual mastery after cloud merge', () => {
  const data = start('old-session'); answer(data, 0, false, t(1)); setQuestionFlag(data, questions[0].id, { masteredAt: t(2) }, t(2)); const base = seedSyncDocument(data);
  const newer = change(base, (d) => { d.session = createSession(questions, 'random', 'new-session', t(3)); answer(d, 0, false, t(4)); }, t(4));
  assert.equal(questionStats(mergeSyncDocuments(base, newer).data, questions[0].id).needsReview, true);
});
test('unsubmitted exam choices sync without any attempt or grading record', () => {
  const base = seedSyncDocument(start('exam', true)); const a = change(base, (d) => { d.session!.selections[questions[0].id] = ['A']; }, t(1));
  const b = change(base, (d) => { d.session!.selections[questions[1].id] = ['B']; d.session!.index = 1; }, t(2));
  const merged = mergeSyncDocuments(a, b); assert.equal(merged.data.attempts.length, 0); assert.equal(merged.data.session!.status, 'active'); assert.equal(Object.keys(merged.data.session!.selections).length, 2); assert.equal(merged.data.session!.index, 1);
  const submitted = change(merged, (d) => recordExam(d, 'exam', questions, answers, t(3)), t(3));
  const final = mergeSyncDocuments(a, submitted); assert.equal(final.data.session!.status, 'finished'); assert.equal(final.data.attempts.length, 3);
});
test('clearing a choice and independent cursor changes are synced by their own clocks', () => {
  const data = start(); data.session!.selections[questions[0].id] = ['A']; const base = seedSyncDocument(data);
  const cleared = change(base, (d) => { d.session!.selections[questions[0].id] = []; }, t(1));
  const moved = change(base, (d) => { d.session!.index = 2; }, t(2)); const merged = mergeSyncDocuments(cleared, moved);
  assert.deepEqual(merged.data.session!.selections[questions[0].id], []); assert.equal(merged.data.session!.index, 2);
});
test('sync clocks remain monotonic when local wall clock is behind another device', () => {
  const doc = change(seedSyncDocument(start()), (d) => { d.session!.index = 1; }, t(4)); assert.ok(nextSyncTime(doc, t(1)) > t(4));
});
test('a slower device can mark an already-received cloud mistake as mastered', () => {
  const data = start(); answer(data, 0, false, t(4)); setQuestionFlag(data, questions[0].id, { masteredAt: masteryTimestamp(data, questions[0].id, t(2)) }, t(2));
  assert.equal(questionStats(data, questions[0].id).mastered, true);
});
test('malformed and future sync documents are rejected without mutating the caller', () => {
  const base = seedSyncDocument(start()); const before = canonical(base);
  assert.throws(() => parseSyncDocument({ ...base, version: 2 }));
  const broken = structuredClone(base); broken.sessions.shared.selectionTimes.unknown = t(1); assert.throws(() => parseSyncDocument(broken));
  const polluted = JSON.parse(canonical(base)); polluted.reviewChanges.constructor = { at: t(1), value: null }; assert.throws(() => parseSyncDocument(polluted));
  assert.equal(canonical(base), before);
});
test('non-ASCII backups roundtrip through GitHub base64 encoding', () => { const text = '错题 · 已掌握 😀\n' + '题'.repeat(100_000); assert.equal(decodeUtf8(encodeUtf8(text)), text); });
test('classic tokens and unsafe repository paths are refused before network access', () => {
  assert.throws(() => validateConnection({ ...connection, token: 'ghp_classic' })); assert.throws(() => validateConnection({ ...connection, repo: '../public-site' }));
});
test('the browser native fetch function keeps its required global receiver', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = function (this: unknown) { assert.equal(this, globalThis); return Promise.resolve(Response.json({ private: true, default_branch: 'main' })); } as typeof fetch;
    assert.deepEqual(await new GitHubSyncClient(connection).repository(), { branch: 'main' });
  } finally { globalThis.fetch = previous; }
});
test('first synchronization creates a private backup; unchanged pulls do not create commits', async () => {
  const device = setup(); const backend = new Backend(); await device.engine.exchange(backend.client()); assert.ok(backend.value); assert.equal(backend.writes, 1);
  await device.engine.exchange(backend.client()); assert.equal(backend.writes, 1);
});
test('two devices automatically exchange history and pick up the current session', async () => {
  const backend = new Backend(), phone = setup(), computer = setup(emptyStudyData());
  await phone.store.update((d) => answer(d)); phone.engine.track(); await phone.engine.exchange(backend.client());
  await computer.engine.exchange(backend.client()); assert.equal(computer.store.snapshot().attempts.length, 1); assert.equal(computer.store.snapshot().session!.id, 'shared');
  await computer.store.update((d) => answer(d, 1, false, t(2))); computer.engine.track(); await computer.engine.exchange(backend.client()); await phone.engine.exchange(backend.client());
  assert.equal(phone.store.snapshot().attempts.length, 2); assert.equal(questionStats(phone.store.snapshot(), questions[1].id).needsReview, true);
  assert.equal(canonical(phone.store.snapshot()), canonical(computer.store.snapshot()));
});
test('stale GitHub SHA triggers refetch, merge and bounded retry instead of overwriting', async () => {
  const backend = new Backend(), local = setup(); await local.store.update((d) => answer(d)); local.engine.track();
  const other = start('other'); answer(other, 1, false, t(2)); backend.beforeWrite = () => { backend.value = seedSyncDocument(other); backend.sequence++; backend.conflict = true; };
  await local.engine.exchange(backend.client()); assert.equal(backend.writes, 2); assert.equal(backend.value!.data.attempts.length, 2); assert.equal(local.store.snapshot().attempts.length, 2);
});
test('answers made while the upload is running remain local and queue another upload', async () => {
  const backend = new Backend(), device = setup(); backend.beforeWrite = () => device.store.update((d) => answer(d));
  const first = await device.engine.exchange(backend.client()); assert.equal(first.pending, true); assert.equal(device.store.snapshot().attempts.length, 1);
  await device.engine.exchange(backend.client()); assert.equal(backend.value!.data.attempts.length, 1);
});
test('private-repository guard stops before reading or writing public files', async () => {
  const backend = new Backend(); backend.private = false; const device = setup();
  await assert.rejects(device.engine.exchange(backend.client()), (error: unknown) => error instanceof SyncError && error.kind === 'privacy'); assert.equal(backend.writes, 0);
});
test('future cloud data and exhausted local cache protect original records', async () => {
  const backend = new Backend(); backend.value = { ...seedSyncDocument(), version: 2 } as unknown as SyncDocument; const device = setup(); const before = canonical(device.store.snapshot());
  await assert.rejects(device.engine.exchange(backend.client())); assert.equal(backend.writes, 0); assert.equal(canonical(device.store.snapshot()), before);
  device.storage.blocked = true; await device.store.update((d) => { d.session!.index = 1; }); assert.throws(() => device.engine.track());
});
test('unfinished alternative sessions can be resumed without duplicating submissions', async () => {
  const backend = new Backend(), device = setup(start('first')); backend.value = captureLocal(seedSyncDocument(), start('second'), t(2));
  await device.engine.exchange(backend.client()); assert.equal(device.engine.unfinished()[0].session.id, 'first');
  await device.engine.resume('first'); assert.equal(device.store.snapshot().session!.id, 'first'); assert.equal(device.store.snapshot().attempts.length, 0);
});
test('large Contents API files use the exact blob SHA, never an arbitrary download URL', async () => {
  const sha = 'f'.repeat(40); const calls: string[] = [];
  const client = new GitHubSyncClient(connection, (async (input: string | URL | Request) => { calls.push(String(input));
    return calls.length === 1 ? Response.json({ type: 'file', size: 1_200_000, sha, encoding: 'none', content: '', download_url: 'https://evil.invalid/' }) : Response.json({ encoding: 'base64', content: encodeUtf8('{"safe":true}') });
  }) as typeof fetch);
  assert.deepEqual((await client.read('main'))?.value, { safe: true }); assert.equal(calls[1], `https://api.github.com/repos/guwan-real/cs-review-records/git/blobs/${sha}`);
});
for (const status of [401, 403, 429]) test(`GitHub ${status} returns an actionable error without echoing credentials`, async () => {
  const client = new GitHubSyncClient(connection, (async () => Response.json({ message: connection.token }, { status })) as typeof fetch);
  await assert.rejects(client.repository(), (error: unknown) => error instanceof SyncError && !error.message.includes(connection.token) && error.kind === (status === 429 ? 'rate' : 'auth'));
});
test('serialized cloud data and normal JSON exports contain no connection credential', async () => {
  const backend = new Backend(), device = setup(); await device.engine.exchange(backend.client());
  assert.ok(!canonical(backend.value).includes(connection.token)); assert.ok(!JSON.stringify(parseStudyData(device.store.snapshot())).includes('github_pat_'));
});
