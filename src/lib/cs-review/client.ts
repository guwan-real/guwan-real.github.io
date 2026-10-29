import { STORAGE_KEY, StudyStore } from './study';
import { escapeHtml as e, fetchJson } from './browser';
import type { ReviewContext } from './browser';
import type { KnowledgeMeta, PublicQuestion } from './types';
import { initGitHubSync } from './sync-client';

const body = document.body;
const base = body.dataset.reviewBase!;
const url = (path = '') => `${base}${path.replace(/^\//, '')}`;
let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* StudyStore shows a persistent warning. */ }
const store = new StudyStore(storage);
const feedback = document.querySelector<HTMLElement>('#cs-feedback')!;
function notify(message: string, success = false) {
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle('is-success', success);
  if (!message) return;
  feedback.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function confirm(title: string, message: string, label: string): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('#review-confirm')!;
  dialog.querySelector('#review-confirm-title')!.textContent = title;
  dialog.querySelector('[data-dialog-message]')!.textContent = message;
  dialog.querySelector('[data-dialog-confirm]')!.textContent = label;
  dialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
function renderShared() {
  const warning = document.querySelector<HTMLElement>('[data-storage-warning]')!;
  warning.hidden = store.state === 'ok';
  warning.innerHTML = `${e(store.message)} <a href="${url('progress/#data')}">前往备份与恢复</a>`;
  const status = document.querySelector<HTMLElement>('[data-storage-status]')!;
  status.hidden = store.state !== 'ok';
  status.innerHTML = `记录保存在当前浏览器 · 刷新、正常关闭后可继续 <a href="${url('progress/#data')}">备份与恢复 ↗</a>`;
  const button = document.querySelector<HTMLButtonElement>('[data-mark-reviewed]');
  if (button) {
    const reviewed = Boolean(store.snapshot().reviewed[button.dataset.markReviewed!]);
    button.setAttribute('aria-pressed', String(reviewed));
    button.textContent = reviewed ? '已复习 · 点击撤销' : '标记已复习';
  }
  const homeSession = document.querySelector<HTMLElement>('[data-home-session]');
  if (homeSession) {
    const session = store.snapshot().session;
    homeSession.hidden = !session || (session.status === 'finished' && session.mode !== 'knowledge');
    if (session) {
      const count = session.mode === 'exam' ? Object.values(session.selections).filter((v) => v.length).length : session.committed.length;
      homeSession.innerHTML = `<div><h2 id="resume-title">${session.status === 'finished' ? '上次知识点练习已完成' : `继续上次${session.mode === 'exam' ? '模拟考试' : '练习'}`}</h2><p>${count} / ${session.questionIds.length} 题已${session.mode === 'exam' ? '作答' : '提交'} · ${session.status === 'finished' ? '可回看解析，选择接下来的复习内容' : '选择与标记已保存'}</p></div><a class="review-button is-small" href="${url('practice/?resume=1')}">${session.status === 'finished' ? '继续复习' : '继续练习'} →</a>`;
    }
  }
}
store.subscribe(renderShared);
renderShared();
document.querySelector('[data-mark-reviewed]')?.addEventListener('click', async (event) => {
  const id = (event.currentTarget as HTMLElement).dataset.markReviewed!;
  try { await store.update((data) => { if (data.reviewed[id]) delete data.reviewed[id]; else data.reviewed[id] = new Date().toISOString(); }); }
  catch (error) { notify(error instanceof Error ? error.message : '无法更新复习状态。'); }
});

let redraw = () => {};
let githubSync: ReturnType<typeof initGitHubSync> | undefined;
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) { store.reload(); redraw(); }
});
async function start() {
  const page = body.dataset.reviewPage;
  if (page === 'knowledge') {
    if (document.querySelector('[data-knowledge-search]')) (await import('./search')).initSearch(url, notify);
    return;
  }
  if (page === 'home') return;
  const [questions, knowledge] = await Promise.all([
    fetchJson<PublicQuestion[]>(url('data/questions.json')),
    fetchJson<KnowledgeMeta[]>(url('data/knowledge.json')),
  ]);
  const context: ReviewContext = { store, questions, knowledge, url, notify, confirm, beforeClear: () => githubSync?.disconnect(true) };
  if (page === 'practice') redraw = await (await import('./practice')).initPractice(context);
  if (page === 'mistakes') redraw = (await import('./dashboard')).initMistakes(context);
  if (page === 'progress') redraw = (await import('./dashboard')).initProgress(context);
}
start().then(() => { githubSync = initGitHubSync(store, storage, url, () => redraw()); }).catch((error) => {
  document.querySelectorAll('[aria-busy="true"]').forEach((el) => el.setAttribute('aria-busy', 'false'));
  notify(error instanceof Error ? error.message : '页面加载失败。请刷新重试。');
  const retry = document.createElement('button');
  retry.className = 'review-button is-small'; retry.textContent = '重新加载';
  retry.addEventListener('click', () => location.reload()); feedback.append(document.createElement('br'), retry);
});
