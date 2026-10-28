export const SYNC_FILE = 'study-records.json';
export const MAX_SYNC_BYTES = 10 * 1024 * 1024;
export interface GitHubConnection { owner: string; repo: string; token: string }
export class SyncError extends Error {
  constructor(message: string, public readonly kind: 'auth' | 'privacy' | 'network' | 'rate' | 'conflict' | 'data', public readonly retryAt = 0) { super(message); }
}
export function validateConnection(value: GitHubConnection): GitHubConnection {
  const owner = value.owner.trim(), repo = value.repo.trim(), token = value.token.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) throw new SyncError('请填写有效的 GitHub 用户名和仓库名。', 'data');
  if (!/^github_pat_[A-Za-z0-9_]{30,250}$/.test(token)) throw new SyncError('请使用仅授权备份仓库的 Fine-grained token，不支持权限过大的经典密钥。', 'auth');
  return { owner, repo, token };
}
export function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function decodeUtf8(value: string): string {
  try { const binary = atob(value.replace(/\s/g, '')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))); }
  catch { throw new SyncError('云端文件编码不正确，未覆盖原文件。', 'data'); }
}
export class GitHubSyncClient {
  private connection: GitHubConnection;
  private root: string;
  private requests = new Set<AbortController>();
  constructor(connection: GitHubConnection, private transport: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    this.connection = validateConnection(connection);
    this.root = `https://api.github.com/repos/${encodeURIComponent(this.connection.owner)}/${encodeURIComponent(this.connection.repo)}`;
  }
  cancel() { for (const request of this.requests) request.abort(); this.requests.clear(); }
  private async request(path: string, init: RequestInit = {}, missing = false): Promise<Record<string, unknown> | null> {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 15_000);
    this.requests.add(abort);
    try {
      const response = await this.transport(this.root + path, { ...init, signal: abort.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.connection.token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
      if (response.status === 401) throw new SyncError('GitHub 密钥已失效或过期，请重新连接；本地记录仍然保留。', 'auth');
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
        const retry = Number(response.headers.get('retry-after')) * 1000 || Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now() || 60_000;
        throw new SyncError('GitHub 暂时限制请求频率，稍后会自动重试。', 'rate', Date.now() + Math.max(60_000, retry));
      }
      if (response.status === 403) throw new SyncError('GitHub 拒绝访问。请检查密钥是否仅选择了备份仓库，并授予 Contents 读写权限。', 'auth');
      if (response.status === 404 && missing) return null;
      if (response.status === 409 || response.status === 422) throw new SyncError('云端刚刚变化，正在重新读取合并。', 'conflict');
      if (response.status === 404) throw new SyncError('找不到备份仓库，或密钥未获该仓库权限。请检查连接设置。', 'auth');
      if (!response.ok) throw new SyncError('GitHub 暂时无法完成同步，本地记录已保留，稍后自动重试。', 'network');
      const text = await response.text();
      if (text.length > MAX_SYNC_BYTES * 1.5) throw new SyncError('云端备份过大，已停止写入，请先导出并整理历史。', 'data');
      const json: unknown = JSON.parse(text);
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new SyncError('GitHub 返回的文件信息不完整。', 'data');
      return json as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError('同步未完成，请检查网络。学习记录仍在本机，联网后会自动重试。', 'network');
    } finally { clearTimeout(timer); this.requests.delete(abort); }
  }
  async repository(): Promise<{ branch: string }> {
    const repo = await this.request('');
    if (repo?.private !== true) throw new SyncError('同步仅允许使用私有仓库，避免答题历史公开。请使用单独的私有备份库。', 'privacy');
    if (repo.archived === true || repo.disabled === true || typeof repo.default_branch !== 'string' || !repo.default_branch) throw new SyncError('备份仓库未初始化、已归档或不可写，请先检查仓库。', 'data');
    return { branch: repo.default_branch };
  }
  async read(branch: string): Promise<{ sha: string; value: unknown } | null> {
    let file = await this.request(`/contents/${SYNC_FILE}?ref=${encodeURIComponent(branch)}`, {}, true);
    if (!file) return null;
    if (file.type !== 'file' || typeof file.sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(file.sha) || typeof file.size !== 'number' || file.size > MAX_SYNC_BYTES) throw new SyncError('云端备份不是可支持的普通 JSON 文件，原内容已保留。', 'data');
    const sha = file.sha;
    // The Contents API omits inline base64 for files above 1 MB. Read that exact blob,
    // never a download_url that could redirect an Authorization header elsewhere.
    if (file.encoding !== 'base64') file = await this.request(`/git/blobs/${sha}`);
    if (file?.encoding !== 'base64' || typeof file.content !== 'string') throw new SyncError('无法读取云端备份内容，原文件已保留。', 'data');
    const text = decodeUtf8(file.content);
    if (new TextEncoder().encode(text).length > MAX_SYNC_BYTES) throw new SyncError('云端备份超过 10 MiB，已停止同步。', 'data');
    try { return { sha, value: JSON.parse(text) }; } catch { throw new SyncError('云端 JSON 损坏，原文件不会被覆盖。请保留备份后检查。', 'data'); }
  }
  async write(branch: string, content: string, sha?: string): Promise<void> {
    if (new TextEncoder().encode(content).length > MAX_SYNC_BYTES) throw new SyncError('同步记录超过 10 MiB，请先导出并整理历史。', 'data');
    await this.request(`/contents/${SYNC_FILE}`, { method: 'PUT', body: JSON.stringify({ branch, message: 'Sync CS Review study records', content: encodeUtf8(content), ...(sha ? { sha } : {}) }) });
  }
}
