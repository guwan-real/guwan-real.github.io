import type { Answer, Attempt, PracticeMode, PublicQuestion, QuestionFlag, QuestionStats, Session, StudyData } from './types';

export const DATA_VERSION = 1;
export const STORAGE_KEY = 'guwan.cs-review.v1';
export const MAX_ATTEMPTS = 50_000;
const modes = new Set<PracticeMode>(['chapter', 'knowledge', 'random', 'mistakes', 'favorites', 'exam']);
const forbidden = new Set(['constructor', 'prototype', '__proto__']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === 'string' && v.length <= 120 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v) && !forbidden.has(v);
const validSessionId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v) && !forbidden.has(v);
const validTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const validRevision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const unique = (v: string[]) => new Set(v).size === v.length;
function options(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 12 && v.every((id) => typeof id === 'string' && /^[A-Z]$/.test(id)) && unique(v);
}
function fail(message: string): never { throw new Error(message); }
export class FutureVersionError extends Error {}
export const emptyStudyData = (): StudyData => ({ version: DATA_VERSION, attempts: [], flags: {}, reviewed: {}, session: null });

export function parseStudyData(input: unknown): StudyData {
  if (!isObject(input)) fail('记录必须为 JSON 对象。');
  if (typeof input.version === 'number' && input.version > DATA_VERSION) throw new FutureVersionError('记录来自更新版本，当前页面无法读取；原数据已保留。');
  if (input.version !== DATA_VERSION) fail('不支持的记录版本；原数据不会被覆盖。');
  if (!Array.isArray(input.attempts) || input.attempts.length > MAX_ATTEMPTS) fail('答题记录格式不正确或超过 50,000 条。');
  const ids = new Set<string>();
  const attempts: Attempt[] = input.attempts.map((v: unknown) => {
    if (!isObject(v) || !validId(v.questionId) || !validRevision(v.revision) || !validSessionId(v.sessionId)
      || !modes.has(v.mode as PracticeMode) || !options(v.selectedOptionIds) || typeof v.correct !== 'boolean' || !validTime(v.answeredAt)
      || v.id !== `${v.sessionId}:${v.questionId}`) fail('答题记录字段不合法。');
    if (v.correct && v.selectedOptionIds.length === 0) fail('未作答记录不能标记为正确。');
    if (ids.has(v.id as string)) fail('答题记录中存在重复提交 ID。');
    ids.add(v.id as string);
    return { id: v.id as string, questionId: v.questionId, revision: v.revision, sessionId: v.sessionId,
      mode: v.mode as PracticeMode, selectedOptionIds: [...v.selectedOptionIds], correct: v.correct, answeredAt: v.answeredAt };
  });
  if (!isObject(input.flags) || !isObject(input.reviewed)) fail('标记或复习记录格式不正确。');
  const flags = Object.fromEntries(Object.entries(input.flags).map(([id, v]) => {
    if (!validId(id) || !isObject(v) || typeof v.favorite !== 'boolean' || typeof v.uncertain !== 'boolean'
      || (v.masteredAt !== null && !validTime(v.masteredAt)) || !validTime(v.updatedAt)) fail('题目标记字段不合法。');
    return [id, { favorite: v.favorite, uncertain: v.uncertain, masteredAt: v.masteredAt as string | null, updatedAt: v.updatedAt }];
  }));
  const reviewed = Object.fromEntries(Object.entries(input.reviewed).map(([id, date]) => {
    if (!validId(id) || !validTime(date)) fail('知识点复习记录字段不合法。');
    return [id, date];
  }));
  let session: Session | null = null;
  if (input.session !== null) {
    const v = input.session;
    if (!isObject(v) || !validSessionId(v.id) || !modes.has(v.mode as PracticeMode)
      || !Array.isArray(v.questionIds) || !v.questionIds.length || v.questionIds.length > 2000 || !v.questionIds.every(validId) || !unique(v.questionIds)
      || !Number.isSafeInteger(v.index) || (v.index as number) < 0 || (v.index as number) >= v.questionIds.length
      || !isObject(v.selections) || !isObject(v.revisions) || !Array.isArray(v.committed) || !unique(v.committed as string[])
      || !v.committed.every((id: unknown) => typeof id === 'string' && (v.questionIds as string[]).includes(id))
      || !['active', 'finished'].includes(v.status as string) || !validTime(v.createdAt)
      || (v.submittedAt !== null && !validTime(v.submittedAt))) fail('练习会话格式不正确。');
    const questionIds = v.questionIds as string[];
    if (Object.keys(v.revisions).length !== questionIds.length || !questionIds.every((id) => validRevision((v.revisions as Record<string, unknown>)[id]))) fail('练习题目版本不完整。');
    if (!Object.entries(v.selections).every(([id, value]) => questionIds.includes(id) && options(value))) fail('练习选项不合法。');
    if (v.mode === 'exam' && v.status === 'active' && v.committed.length) fail('未交卷的模拟考试不能存在已判分题目。');
    if ((v.status === 'finished') !== (v.submittedAt !== null)) fail('练习提交状态不一致。');
    if (v.status === 'finished' && v.committed.length !== questionIds.length) fail('已完成练习缺少提交题目。');
    const sessionAttempts = new Map(attempts.filter((a) => a.sessionId === v.id).map((a) => [a.questionId, a]));
    if (sessionAttempts.size !== v.committed.length) fail('练习与提交数量不一致。');
    for (const id of v.committed as string[]) {
      const attempt = sessionAttempts.get(id);
      if (!attempt || attempt.mode !== v.mode || attempt.revision !== v.revisions[id] || !sameOptions(attempt.selectedOptionIds, (v.selections[id] as string[] | undefined) ?? [])) fail('练习与答题历史不一致。');
    }
    session = { id: v.id, mode: v.mode as PracticeMode, questionIds, index: v.index as number,
      revisions: { ...v.revisions } as Record<string, number>, selections: { ...v.selections } as Record<string, string[]>,
      committed: [...v.committed] as string[], status: v.status as Session['status'], createdAt: v.createdAt, submittedAt: v.submittedAt as string | null };
  }
  return { version: DATA_VERSION, attempts, flags, reviewed, session };
}

export function parseBackup(value: unknown): StudyData {
  if (!isObject(value) || value.format !== 'guwan-cs-review' || !validTime(value.exportedAt)) fail('请选择本工具导出的学习记录 JSON。');
  return parseStudyData(value.data);
}
export function createBackup(data: StudyData) {
  return { format: 'guwan-cs-review', exportedAt: new Date().toISOString(), data };
}
export function mergeStudyData(local: StudyData, incoming: StudyData): StudyData {
  const attempts = new Map(local.attempts.map((a) => [a.id, a]));
  for (const a of incoming.attempts) {
    const previous = attempts.get(a.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(a)) fail('备份中存在与当前历史冲突的提交，请保留两份导出文件核对。');
    attempts.set(a.id, a);
  }
  const flags = { ...local.flags };
  for (const [id, flag] of Object.entries(incoming.flags)) {
    if (!flags[id] || flag.updatedAt > flags[id].updatedAt) flags[id] = flag;
  }
  const reviewed = { ...local.reviewed };
  for (const [id, date] of Object.entries(incoming.reviewed)) if (!reviewed[id] || date > reviewed[id]) reviewed[id] = date;
  return parseStudyData({ version: DATA_VERSION, attempts: [...attempts.values()], flags, reviewed, session: local.session ?? incoming.session });
}
export function sameOptions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && unique([...a]) && [...a].sort().every((id, index) => id === [...b].sort()[index]);
}
export function questionStats(data: StudyData, id: string): QuestionStats {
  const attempts = data.attempts.filter((a) => a.questionId === id).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const wrong = attempts.filter((a) => !a.correct);
  const flag = data.flags[id];
  const lastWrong = wrong.at(-1);
  const mastered = Boolean(lastWrong && flag?.masteredAt && flag.masteredAt >= lastWrong.answeredAt);
  return { attempts: attempts.length, wrongCount: wrong.length, latest: attempts.at(-1) ?? null,
    needsReview: wrong.length > 0 && !mastered, favorite: flag?.favorite ?? false, uncertain: flag?.uncertain ?? false, mastered };
}
export const emptyQuestionStats = (): QuestionStats => ({ attempts: 0, wrongCount: 0, latest: null, needsReview: false, favorite: false, uncertain: false, mastered: false });
export function questionStatsIndex(data: StudyData): Map<string, QuestionStats> {
  const histories = new Map<string, { count: number; wrong: number; latest: Attempt | null; lastWrong: Attempt | null }>();
  for (const attempt of data.attempts) {
    const history = histories.get(attempt.questionId) ?? { count: 0, wrong: 0, latest: null, lastWrong: null };
    history.count++;
    if (!history.latest || attempt.answeredAt >= history.latest.answeredAt) history.latest = attempt;
    if (!attempt.correct) { history.wrong++; if (!history.lastWrong || attempt.answeredAt >= history.lastWrong.answeredAt) history.lastWrong = attempt; }
    histories.set(attempt.questionId, history);
  }
  return new Map([...new Set([...histories.keys(), ...Object.keys(data.flags)])].map((id) => {
    const history = histories.get(id); const flag = data.flags[id];
    const mastered = Boolean(history?.lastWrong && flag?.masteredAt && flag.masteredAt >= history.lastWrong.answeredAt);
    return [id, { attempts: history?.count ?? 0, wrongCount: history?.wrong ?? 0, latest: history?.latest ?? null,
      needsReview: Boolean(history?.wrong) && !mastered, mastered, favorite: flag?.favorite ?? false, uncertain: flag?.uncertain ?? false }];
  }));
}
export function setQuestionFlag(data: StudyData, id: string, patch: Partial<Omit<QuestionFlag, 'updatedAt'>>, now = new Date().toISOString()) {
  const previous: QuestionFlag | undefined = data.flags[id];
  data.flags[id] = { ...(previous ?? { favorite: false, uncertain: false, masteredAt: null }), ...patch, updatedAt: now };
}
export function createSession(questions: PublicQuestion[], mode: PracticeMode, id: string, now = new Date().toISOString()): Session {
  if (!questions.length) fail('当前条件下没有可练习的题目。');
  return { id, mode, questionIds: questions.map((q) => q.id), revisions: Object.fromEntries(questions.map((q) => [q.id, q.revision])),
    index: 0, selections: {}, committed: [], status: 'active', createdAt: now, submittedAt: null };
}
export function appendAttempt(data: StudyData, attempt: Attempt) {
  if (!data.attempts.some((a) => a.id === attempt.id)) {
    if (data.attempts.length >= MAX_ATTEMPTS) fail('已达到本地 50,000 条记录上限，请先导出备份并清理记录。');
    data.attempts.push(attempt);
    if (!attempt.correct && data.flags[attempt.questionId]?.masteredAt) setQuestionFlag(data, attempt.questionId, { masteredAt: null }, attempt.answeredAt);
  }
}

function activeSession(data: StudyData, id: string) {
  if (!data.session || data.session.id !== id) fail('当前练习已被另一页面替换，请刷新后继续。');
  return data.session;
}
function grade(session: Session, question: PublicQuestion, answer: Answer, now: string): Attempt {
  if (!answer.correctOptionIds.length || !session.questionIds.includes(question.id) || question.id !== answer.id || question.revision !== answer.revision
    || session.revisions[question.id] !== question.revision || answer.correctOptionIds.some((id) => !question.options.some((o) => o.id === id))) fail('题目与答案版本不一致，当前选择已保留。');
  const selected = [...(session.selections[question.id] ?? [])];
  return { id: `${session.id}:${question.id}`, questionId: question.id, revision: question.revision, sessionId: session.id,
    mode: session.mode, selectedOptionIds: selected, correct: sameOptions(selected, answer.correctOptionIds), answeredAt: now };
}
export function recordPracticeAnswer(data: StudyData, sessionId: string, question: PublicQuestion, answer: Answer, now = new Date().toISOString()) {
  const session = activeSession(data, sessionId);
  if (session.mode === 'exam') fail('模拟考试必须交卷后统一判分。');
  if (session.committed.includes(question.id)) return;
  if (!session.selections[question.id]?.length) fail('先选择一个答案，再查看解析。');
  appendAttempt(data, grade(session, question, answer, now));
  session.committed.push(question.id);
  if (session.committed.length === session.questionIds.length) { session.status = 'finished'; session.submittedAt = now; }
}
export function recordExam(data: StudyData, sessionId: string, questions: PublicQuestion[], answers: Answer[], now = new Date().toISOString()) {
  const session = activeSession(data, sessionId);
  if (session.mode !== 'exam') fail('当前不是模拟考试。');
  if (session.status === 'finished') return;
  const attempts = session.questionIds.map((id) => {
    const question = questions.find((q) => q.id === id);
    const answer = answers.find((a) => a.id === id);
    if (!question || !answer) fail('判分资料不完整，请检查网络后重试交卷。');
    return grade(session, question, answer, now);
  });
  if (data.attempts.length + attempts.filter((a) => !data.attempts.some((old) => old.id === a.id)).length > MAX_ATTEMPTS) fail('记录已达到上限，请先导出备份。');
  attempts.forEach((attempt) => appendAttempt(data, attempt));
  session.committed = [...session.questionIds]; session.status = 'finished'; session.submittedAt = now;
}

export type StorageState = 'ok' | 'unavailable' | 'corrupt' | 'future' | 'quota';
type StorageAdapter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class StudyStore {
  private data = emptyStudyData();
  state: StorageState = 'ok';
  message = '';
  private listeners = new Set<() => void>();
  constructor(private storage: StorageAdapter | null) { this.reload(); }
  snapshot() { return this.data; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify() { this.listeners.forEach((fn) => fn()); }
  reload() {
    // Preserve exportable activity accumulated after a write/read failure, including on a later cross-tab event.
    if (this.state !== 'ok') { this.notify(); return; }
    try {
      if (!this.storage) throw new Error('unavailable');
      const raw = this.storage.getItem(STORAGE_KEY);
      this.data = raw === null ? emptyStudyData() : parseStudyData(JSON.parse(raw));
      this.state = 'ok'; this.message = '';
    } catch (error) {
      if (error instanceof FutureVersionError) { this.state = 'future'; this.message = `${error.message} 当前新增记录仅在本页暂存，请先导出原始记录。`; }
      else if (error instanceof SyntaxError || (error instanceof Error && error.message !== 'unavailable' && error.name !== 'SecurityError')) {
        this.state = 'corrupt'; this.message = '本地记录格式异常，原记录已保留。请先导出原始记录，再清空或恢复备份。当前新增记录仅在本页暂存。';
      } else { this.state = 'unavailable'; this.message = '浏览器无法使用本地存储，当前记录仅在本页暂存。离开前请导出备份。'; }
    }
    this.notify();
  }
  async update(change: (data: StudyData) => void) {
    const write = () => {
      // Read inside the cross-tab lock before merging changes to avoid stale-tab overwrites.
      if (this.state === 'ok') this.reload();
      const next = structuredClone(this.data);
      change(next);
      this.data = parseStudyData(next);
      if (this.state === 'ok') {
        try { this.storage!.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
        catch { this.state = 'quota'; this.message = '记录未能写入浏览器，可能已用完本地空间。新增记录仅在本页暂存，请立即导出备份。'; }
      }
      this.notify();
    };
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(STORAGE_KEY, write);
    else write();
  }
  async sessionUpdate(id: string, change: (session: Session, data: StudyData) => void) {
    await this.update((data) => {
      if (!data.session || data.session.id !== id) fail('另一个页面已更换练习，请刷新后继续当前练习。');
      change(data.session, data);
    });
  }
  rawRecord() { try { return this.storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } }
  async clear() {
    const clear = () => {
      // Only our namespaced key is touched; the personal homepage's data is unaffected.
      try { if (!this.storage) throw new Error(); this.storage.removeItem(STORAGE_KEY); this.state = 'ok'; this.message = ''; }
      catch { this.state = 'unavailable'; this.message = '浏览器无法清理本地存储，请在浏览器设置中处理。'; }
      this.data = emptyStudyData(); this.notify();
    };
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(STORAGE_KEY, clear);
    else clear();
  }
}
