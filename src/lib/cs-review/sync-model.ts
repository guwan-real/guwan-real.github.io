import { emptyStudyData, parseStudyData, sameOptions } from './study';
import type { Attempt, QuestionFlag, Session, StudyData } from './types';

const EPOCH = '1970-01-01T00:00:00.000Z';
type FlagTimes = Record<'favorite' | 'uncertain' | 'masteredAt', string>;
export interface SyncedSession { session: Session; editedAt: string; indexAt: string; selectionTimes: Record<string, string> }
export interface SyncDocument {
  format: 'guwan-cs-review-sync'; version: 1; data: StudyData;
  reviewChanges: Record<string, { at: string; value: string | null }>;
  flagTimes: Record<string, FlagTimes>;
  sessions: Record<string, SyncedSession>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (s: string) => /^[a-zA-Z0-9-]{1,120}$/.test(s) && !['constructor', 'prototype', '__proto__'].includes(s);
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const last = (...dates: (string | null | undefined)[]) => dates.reduce<string>((a, b) => b && b > a ? b : a, EPOCH);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const choose = <T>(a: T, ta: string, b: T, tb: string): T => ta === tb ? canonical(a) >= canonical(b) ? a : b : ta > tb ? a : b;
const timesFor = (f: QuestionFlag): FlagTimes => ({ favorite: f.updatedAt, uncertain: f.updatedAt, masteredAt: f.updatedAt });

export function seedSyncDocument(data: StudyData = emptyStudyData()): SyncDocument {
  data = parseStudyData(data);
  const session = data.session;
  const at = session ? last(session.createdAt, session.submittedAt, ...data.attempts.filter((a) => a.sessionId === session.id).map((a) => a.answeredAt)) : EPOCH;
  return { format: 'guwan-cs-review-sync', version: 1, data: structuredClone(data),
    reviewChanges: Object.fromEntries(Object.entries(data.reviewed).map(([id, value]) => [id, { at: value, value }])),
    flagTimes: Object.fromEntries(Object.entries(data.flags).map(([id, flag]) => [id, timesFor(flag)])),
    sessions: session ? { [session.id]: { session: structuredClone(session), editedAt: at, indexAt: at, selectionTimes: Object.fromEntries(Object.keys(session.selections).map((id) => [id, at])) } } : {} };
}

export function parseSyncDocument(input: unknown): SyncDocument {
  if (!object(input) || input.format !== 'guwan-cs-review-sync' || input.version !== 1) throw new Error('云端同步格式不支持，已停止写入并保留原文件。请更新页面或检查备份。');
  const data = parseStudyData(input.data);
  if (!object(input.reviewChanges) || !object(input.flagTimes) || !object(input.sessions)) throw new Error('云端同步信息损坏，原文件不会被覆盖。');
  const reviewChanges: SyncDocument['reviewChanges'] = {};
  for (const [id, v] of Object.entries(input.reviewChanges)) {
    if (!safeKey(id) || !object(v) || !time(v.at) || (v.value !== null && !time(v.value)) || (v.value ?? undefined) !== data.reviewed[id]) throw new Error('云端复习标记不完整，原文件已保留。');
    reviewChanges[id] = { at: v.at, value: v.value as string | null };
  }
  if (Object.keys(data.reviewed).some((id) => !reviewChanges[id])) throw new Error('云端缺少复习标记的同步时间。');
  const flagTimes: SyncDocument['flagTimes'] = {};
  for (const [id, v] of Object.entries(input.flagTimes)) {
    if (!safeKey(id) || !data.flags[id] || !object(v) || !time(v.favorite) || !time(v.uncertain) || !time(v.masteredAt)) throw new Error('云端题目标记的同步时间不完整。');
    flagTimes[id] = { favorite: v.favorite, uncertain: v.uncertain, masteredAt: v.masteredAt };
  }
  if (Object.keys(data.flags).some((id) => !flagTimes[id])) throw new Error('云端缺少题目标记的同步时间。');
  const sessions: SyncDocument['sessions'] = {};
  if (Object.keys(input.sessions).length > 64) throw new Error('未完成练习过多，请先完成或整理后再同步。');
  for (const [id, v] of Object.entries(input.sessions)) {
    if (!safeKey(id) || !object(v) || !time(v.editedAt) || !time(v.indexAt) || !object(v.selectionTimes)) throw new Error('云端练习的同步信息不完整。');
    const selectionTimes = v.selectionTimes;
    const session = parseStudyData({ ...data, session: v.session }).session;
    if (!session || session.id !== id || Object.entries(selectionTimes).some(([qid, at]) => !session.questionIds.includes(qid) || !time(at))
      || Object.keys(session.selections).some((qid) => !selectionTimes[qid])) throw new Error('云端练习的选择时间不完整。');
    sessions[id] = { session, editedAt: v.editedAt, indexAt: v.indexAt, selectionTimes: { ...selectionTimes } as Record<string, string> };
  }
  if (data.session && canonical(data.session) !== canonical(sessions[data.session.id]?.session)) throw new Error('云端当前练习与保存的练习不一致。');
  return { format: 'guwan-cs-review-sync', version: 1, data, reviewChanges, flagTimes, sessions };
}

export function nextSyncTime(doc: SyncDocument, now = new Date().toISOString()): string {
  const maximum = last(...Object.values(doc.sessions).map((s) => s.editedAt), ...Object.values(doc.reviewChanges).map((r) => r.at), ...Object.values(doc.flagTimes).flatMap(Object.values));
  return now > maximum ? now : new Date(Date.parse(maximum) + 1).toISOString();
}

export function captureLocal(doc: SyncDocument, input: StudyData, now = nextSyncTime(doc)): SyncDocument {
  const next = structuredClone(doc); const data = parseStudyData(input); const before = doc.data;
  for (const id of new Set([...Object.keys(before.reviewed), ...Object.keys(data.reviewed)])) {
    if (before.reviewed[id] !== data.reviewed[id]) next.reviewChanges[id] = { at: now, value: data.reviewed[id] ?? null };
  }
  for (const [id, flag] of Object.entries(data.flags)) {
    const previous = before.flags[id]; const clocks = next.flagTimes[id] ?? timesFor(flag);
    for (const field of ['favorite', 'uncertain', 'masteredAt'] as const) if (!previous || previous[field] !== flag[field]) clocks[field] = now;
    next.flagTimes[id] = clocks;
  }
  if (data.session && canonical(before.session) !== canonical(data.session)) {
    const s = data.session; const prior = next.sessions[s.id]; const selectionTimes = { ...prior?.selectionTimes };
    for (const id of new Set([...Object.keys(prior?.session.selections ?? {}), ...Object.keys(s.selections)])) {
      if (canonical(prior?.session.selections[id] ?? []) !== canonical(s.selections[id] ?? [])) selectionTimes[id] = now;
    }
    next.sessions[s.id] = { session: structuredClone(s), editedAt: now,
      indexAt: !prior || prior.session.index !== s.index || before.session?.id !== s.id ? now : prior.indexAt, selectionTimes };
  }
  next.data = data;
  return normalize(next);
}

// The same logical question can be submitted on two offline devices. Keep both results
// under deterministic IDs instead of overwriting either device's history.
function forkId(attempt: Attempt): string {
  let hash = 14695981039346656037n;
  for (const char of canonical(attempt)) { hash ^= BigInt(char.codePointAt(0)!); hash = BigInt.asUintN(64, hash * 1099511628211n); }
  return `sync-${hash.toString(36)}`;
}
function mergeAttempts(a: Attempt[], b: Attempt[]): Attempt[] {
  const index = new Map<string, Attempt>();
  for (const entry of [...a, ...b]) {
    const item = structuredClone(entry); item.selectedOptionIds.sort();
    const previous = index.get(item.id);
    if (!previous) { index.set(item.id, item); continue; }
    if (canonical(previous) === canonical(item)) continue;
    const winner = choose(previous, previous.answeredAt, item, item.answeredAt);
    if (previous.revision === item.revision && previous.correct === item.correct && sameOptions(previous.selectedOptionIds, item.selectedOptionIds)) { index.set(item.id, winner); continue; }
    const other = winner === previous ? item : previous;
    const sessionId = forkId(other); const fork = { ...other, sessionId, id: `${sessionId}:${other.questionId}` };
    const existing = index.get(fork.id);
    if (existing && canonical(existing) !== canonical(fork)) throw new Error('并行提交标识冲突，已停止同步并保留本地历史。');
    index.set(item.id, winner); index.set(fork.id, fork);
  }
  return [...index.values()].sort((x, y) => x.id.localeCompare(y.id));
}

function normalize(doc: SyncDocument): SyncDocument {
  const attempts = doc.data.attempts;
  for (const record of Object.values(doc.sessions)) {
    const s = record.session;
    const actual = attempts.filter((a) => a.sessionId === s.id);
    if (actual.some((a) => !s.questionIds.includes(a.questionId) || s.revisions[a.questionId] !== a.revision || s.mode !== a.mode)) throw new Error('同一练习的题目版本不一致，请保留备份后重新开始。');
    s.committed = s.questionIds.filter((id) => actual.some((a) => a.questionId === id));
    for (const a of actual) s.selections[a.questionId] = [...a.selectedOptionIds];
    s.status = s.committed.length === s.questionIds.length ? 'finished' : 'active';
    s.submittedAt = s.status === 'finished' ? last(...actual.map((a) => a.answeredAt)) : null;
    for (const id of Object.keys(s.selections)) record.selectionTimes[id] ??= record.editedAt;
    if (s.mode === 'exam' && s.status === 'active' && actual.length) throw new Error('模拟试卷的云端提交不完整，原记录已保留。');
  }
  const records = Object.values(doc.sessions).sort((a, b) => b.editedAt.localeCompare(a.editedAt) || b.session.id.localeCompare(a.session.id));
  // Retain every unfinished session; old completed sessions are already in attempt history.
  records.forEach((record, i) => { if (i >= 16 && record.session.status === 'finished') delete doc.sessions[record.session.id]; });
  doc.data.session = records[0] ? structuredClone(records[0].session) : null;
  const lastWrong = new Map<string, string>();
  for (const attempt of attempts) if (!attempt.correct && attempt.answeredAt > (lastWrong.get(attempt.questionId) ?? EPOCH)) lastWrong.set(attempt.questionId, attempt.answeredAt);
  for (const [id, flag] of Object.entries(doc.data.flags)) {
    flag.updatedAt = last(...Object.values(doc.flagTimes[id]));
    const wrong = lastWrong.get(id);
    if (wrong && flag.masteredAt && wrong > flag.masteredAt) flag.masteredAt = null;
  }
  return parseSyncDocument(doc);
}

export function mergeSyncDocuments(left: SyncDocument, right: SyncDocument): SyncDocument {
  const a = parseSyncDocument(left), b = parseSyncDocument(right); const result = structuredClone(a);
  result.data.attempts = mergeAttempts(a.data.attempts, b.data.attempts);
  for (const id of new Set([...Object.keys(a.reviewChanges), ...Object.keys(b.reviewChanges)])) {
    const x = a.reviewChanges[id], y = b.reviewChanges[id]; const v = !x ? y : !y ? x : choose(x, x.at, y, y.at);
    result.reviewChanges[id] = v;
    if (v.value) result.data.reviewed[id] = v.value; else delete result.data.reviewed[id];
  }
  for (const id of new Set([...Object.keys(a.data.flags), ...Object.keys(b.data.flags)])) {
    const x = a.data.flags[id], y = b.data.flags[id];
    if (!x || !y) { result.data.flags[id] = structuredClone(x ?? y); result.flagTimes[id] = { ...(a.flagTimes[id] ?? b.flagTimes[id]) }; continue; }
    const tx = a.flagTimes[id], ty = b.flagTimes[id];
    result.flagTimes[id] = { favorite: last(tx.favorite, ty.favorite), uncertain: last(tx.uncertain, ty.uncertain), masteredAt: last(tx.masteredAt, ty.masteredAt) };
    result.data.flags[id] = { favorite: choose(x.favorite, tx.favorite, y.favorite, ty.favorite), uncertain: choose(x.uncertain, tx.uncertain, y.uncertain, ty.uncertain),
      masteredAt: choose(x.masteredAt, tx.masteredAt, y.masteredAt, ty.masteredAt), updatedAt: last(x.updatedAt, y.updatedAt) };
  }
  for (const id of new Set([...Object.keys(a.sessions), ...Object.keys(b.sessions)])) {
    const x = a.sessions[id], y = b.sessions[id];
    if (!x || !y) { result.sessions[id] = structuredClone(x ?? y); continue; }
    if (canonical([x.session.mode, x.session.questionIds, x.session.revisions, x.session.createdAt]) !== canonical([y.session.mode, y.session.questionIds, y.session.revisions, y.session.createdAt])) throw new Error('同一练习的题目结构冲突，请先保留两份备份。');
    if (x.session.knowledgeId && y.session.knowledgeId && x.session.knowledgeId !== y.session.knowledgeId) throw new Error('同一练习的知识点冲突，请先保留两份备份。');
    const merged = structuredClone(choose(x, x.editedAt, y, y.editedAt));
    const knowledgeId = x.session.knowledgeId ?? y.session.knowledgeId;
    if (knowledgeId) merged.session.knowledgeId = knowledgeId;
    merged.editedAt = last(x.editedAt, y.editedAt); merged.indexAt = last(x.indexAt, y.indexAt);
    merged.session.index = choose(x.session.index, x.indexAt, y.session.index, y.indexAt);
    for (const qid of new Set([...Object.keys(x.session.selections), ...Object.keys(y.session.selections)])) {
      const tx = x.selectionTimes[qid] ?? EPOCH, ty = y.selectionTimes[qid] ?? EPOCH;
      merged.selectionTimes[qid] = last(tx, ty);
      merged.session.selections[qid] = choose(x.session.selections[qid] ?? [], tx, y.session.selections[qid] ?? [], ty);
    }
    result.sessions[id] = merged;
  }
  return normalize(result);
}
