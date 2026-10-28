import { escapeHtml as e, formatDate } from './browser';
import { GitHubSyncClient, SyncError, validateConnection } from './github-api';
import type { GitHubConnection } from './github-api';
import { cacheKey, StudySyncEngine } from './sync-engine';
import type { StudyStore } from './study';

const CONNECTION_KEY = 'guwan.cs-review.github.connection.v1';
interface SavedConnection extends GitHubConnection { version: 1; remember: boolean }
export function initGitHubSync(store: StudyStore, storage: Storage | null, url: (path: string) => string, redraw: () => void) {
  let sessionStorage: Storage | null = null;
  try { sessionStorage = window.sessionStorage; } catch { /* Current-page connection still works. */ }
  const section = document.querySelector<HTMLElement>('#github-sync');
  const form = section?.querySelector<HTMLFormElement>('[data-sync-form]');
  let connection: SavedConnection | null = null;
  let engine: StudySyncEngine | undefined;
  let client: GitHubSyncClient | undefined;
  let generation = 0, lastRun = 0, retryAt = 0;
  let running = false, dirty = false, paused = false, editing = false;
  let message = '当前仅在本机保存。';
  let timer: ReturnType<typeof setTimeout> | undefined;
  function render() {
    const status = document.querySelector<HTMLElement>('[data-github-sync-status]');
    if (status) {
      status.classList.toggle('is-sync-error', Boolean(connection && paused));
      status.innerHTML = `${e(connection ? `GitHub · ${message}` : '想在手机和电脑之间接着练？')} <a href="${url('progress/#github-sync')}">${connection ? '同步设置' : '开启私有备份'} ↗</a>`;
    }
    if (!section || !form) return;
    form.querySelector<HTMLFieldSetElement>('[data-sync-fields]')!.disabled = false;
    section.querySelector<HTMLElement>('[data-sync-message]')!.textContent = message;
    section.querySelector<HTMLElement>('[data-sync-connected]')!.hidden = !connection;
    form.hidden = Boolean(connection && !editing);
    const cancel = form.querySelector<HTMLButtonElement>('[data-sync-action="cancel"]')!; cancel.hidden = !connection;
    form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = running;
    const now = section.querySelector<HTMLButtonElement>('[data-sync-action="now"]')!; now.disabled = running;
    now.textContent = running ? '正在同步…' : '立即同步';
    if (connection) {
      const link = section.querySelector<HTMLAnchorElement>('[data-sync-repository]')!;
      link.href = `https://github.com/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
      link.textContent = `${connection.owner}/${connection.repo} · 私有备份`;
    }
    const alternatives = engine?.unfinished() ?? [];
    section.querySelector<HTMLElement>('[data-sync-sessions]')!.innerHTML = alternatives.length ? `<details class="review-sync-guide"><summary>其他未完成练习 · ${alternatives.length} 组</summary><ul class="review-sync-session-list">${alternatives.map(({ session, editedAt }) => `<li><span>${session.mode === 'exam' ? '模拟考试' : '练习'} · ${session.questionIds.length} 题 · ${formatDate(editedAt)}</span><button class="review-button is-small" data-sync-resume="${e(session.id)}">接着这一组 →</button></li>`).join('')}</ul></details>` : '';
  }
  function schedule(delay = 1200) {
    clearTimeout(timer);
    if (!connection || paused) return;
    timer = setTimeout(() => void sync(), Math.max(delay, 15_000 - (Date.now() - lastRun), retryAt - Date.now()));
  }
  function problem(error: unknown) {
    const issue = error instanceof SyncError ? error : new SyncError(error instanceof Error ? error.message : '同步数据无法读取，请保留备份后检查。', 'data');
    paused = ['auth', 'privacy', 'data'].includes(issue.kind);
    retryAt = issue.kind === 'rate' ? issue.retryAt : Date.now() + 30_000;
    message = issue.message; render();
    if (!paused) schedule(30_000);
  }
  async function sync(force = false) {
    if (!connection || !engine || !client || running || (paused && !force)) return;
    if (Date.now() < retryAt && !force) { schedule(retryAt - Date.now()); return; }
    if (!navigator.onLine) { message = '离线，已保存在本机；联网后自动同步'; dirty = true; render(); return; }
    clearTimeout(timer); running = true; paused = false; lastRun = Date.now();
    const current = generation; message = '正在同步…'; render();
    try {
      const result = await engine.exchange(client, () => current === generation);
      if (current !== generation) return;
      dirty = result.pending; retryAt = 0;
      message = result.pending ? '本机有新记录，等待下一次同步' : `已同步 · ${formatDate(new Date().toISOString())}`;
      if (result.changed) redraw();
    } catch (error) { if (current === generation) problem(error); }
    finally {
      if (current === generation) { running = false; render(); if (dirty && !paused) schedule(); }
    }
  }
  function forgetCredentials() { try { storage?.removeItem(CONNECTION_KEY); sessionStorage?.removeItem(CONNECTION_KEY); } catch { /* Reported by local store if unavailable. */ } }
  function disconnect(clearCache = false, forget = true) {
    generation++; clearTimeout(timer); if (forget) forgetCredentials();
    if (clearCache && connection) { try { storage?.removeItem(cacheKey(connection.owner, connection.repo)); } catch { /* Study data is managed separately. */ } }
    client?.cancel(); connection = null; engine = undefined; client = undefined; running = false; dirty = false; paused = false; editing = false;
    message = '已断开本机连接，本地历史和 GitHub 备份均保留。'; render();
  }
  function activate(value: SavedConnection) {
    connection = { ...validateConnection(value), version: 1, remember: value.remember };
    client = new GitHubSyncClient(connection);
    engine = undefined;
    engine = new StudySyncEngine(store, storage, cacheKey(connection.owner, connection.repo));
    dirty = true; editing = false; paused = false; retryAt = 0;
  }
  store.subscribe(() => {
    if (!engine) return;
    try {
      if (engine.track()) { dirty = true; message = '本机有新记录，待同步'; render(); schedule(); }
    } catch (error) { problem(error); }
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (running) return;
    const values = new FormData(form);
    try {
      const candidate = validateConnection({ owner: String(values.get('owner') ?? ''), repo: String(values.get('repo') ?? ''), token: String(values.get('token') ?? '') });
      generation++; client?.cancel(); clearTimeout(timer); forgetCredentials();
      activate({ ...candidate, version: 1, remember: values.has('remember') });
      await sync(true);
      if (paused || !connection) { editing = true; render(); return; }
      const target = connection.remember ? storage : sessionStorage;
      try { if (!target) throw new Error(); target.setItem(CONNECTION_KEY, JSON.stringify(connection)); }
      catch { message = '本次同步可用，但浏览器无法保持连接；离开后需重新连接。'; }
      (form.elements.namedItem('token') as HTMLInputElement).value = '';
      render();
    } catch (error) { problem(error); editing = true; render(); }
  });
  form?.addEventListener('input', () => {
    const owner = (form.elements.namedItem('owner') as HTMLInputElement).value.trim();
    const link = form.querySelector<HTMLAnchorElement>('[data-sync-token-link]')!;
    const target = new URL('https://github.com/settings/personal-access-tokens/new');
    target.search = new URLSearchParams({ name: 'CS Review sync', description: 'Personal CS Review private backup', target_name: owner, expires_in: '90', contents: 'write' }).toString(); link.href = target.href;
  });
  section?.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    const action = button.dataset.syncAction;
    if (action === 'now') void sync(true);
    if (action === 'disconnect') disconnect(!engine);
    if (action === 'edit') { editing = true; render(); (form!.elements.namedItem('token') as HTMLInputElement).focus(); }
    if (action === 'cancel') { editing = false; render(); }
    if (button.dataset.syncResume && engine) {
      try { await engine.resume(button.dataset.syncResume); redraw(); render(); location.href = url('practice/?resume=1'); }
      catch (error) { problem(error); }
    }
  });
  window.addEventListener('online', () => { if (connection) { retryAt = 0; schedule(0); } });
  window.addEventListener('focus', () => { if (connection && !document.hidden) schedule(0); });
  document.addEventListener('visibilitychange', () => { if (connection && (!document.hidden || dirty)) schedule(0); });
  let polling = window.setInterval(() => { if (connection && !document.hidden) void sync(); }, 60_000);
  window.addEventListener('pagehide', () => { generation++; clearInterval(polling); clearTimeout(timer); client?.cancel(); running = false; });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    clearInterval(polling); polling = window.setInterval(() => { if (connection && !document.hidden) void sync(); }, 60_000);
    if (connection) { generation++; running = false; void sync(true); }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === CONNECTION_KEY && connection?.remember) {
      disconnect(false, false); message = '另一页已更换或移除连接。本页已停止同步，请重新连接或刷新。'; render();
    }
  });
  try {
    const raw = sessionStorage?.getItem(CONNECTION_KEY) ?? storage?.getItem(CONNECTION_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || (value as SavedConnection).version !== 1 || typeof (value as SavedConnection).remember !== 'boolean') throw new Error();
      activate(value as SavedConnection); void sync(true);
    }
  } catch { message = '本机同步连接无法读取。请重新填写密钥；答题记录未改变。'; editing = true; }
  render();
  if (section && location.hash === '#github-sync') section.scrollIntoView({ block: 'start', behavior: 'instant' });
  return { disconnect };
}
