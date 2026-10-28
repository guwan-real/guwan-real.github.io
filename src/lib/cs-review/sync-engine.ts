import { GitHubSyncClient, SyncError } from './github-api';
import { canonical, captureLocal, mergeSyncDocuments, parseSyncDocument, seedSyncDocument } from './sync-model';
import type { SyncDocument } from './sync-model';
import type { StudyStore } from './study';

export const cacheKey = (owner: string, repo: string) => `guwan.cs-review.sync.v1.${owner.toLowerCase()}/${repo.toLowerCase()}`;
type Cache = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class StudySyncEngine {
  document: SyncDocument;
  applying = false;
  constructor(private store: StudyStore, private cache: Cache | null, readonly key: string) {
    if (store.state !== 'ok') throw new SyncError('本地存储存在异常，请先导出并修复本地记录，再启用同步。', 'data');
    try {
      const raw = cache?.getItem(key);
      this.document = raw ? captureLocal(parseSyncDocument(JSON.parse(raw)), store.snapshot()) : seedSyncDocument(store.snapshot());
    } catch { throw new SyncError('本机同步缓存无法读取。答题记录未改变，请先导出记录，再断开并重建连接。', 'data'); }
    this.persist();
  }
  private persist() {
    try { if (!this.cache) throw new Error(); this.cache.setItem(this.key, JSON.stringify(this.document)); }
    catch { throw new SyncError('本机没有足够空间保存同步信息。答题记录仍在本地，请导出备份并整理空间。', 'data'); }
  }
  track(): boolean {
    if (this.applying || canonical(this.document.data) === canonical(this.store.snapshot())) return false;
    this.document = captureLocal(this.document, this.store.snapshot()); this.persist(); return true;
  }
  unfinished() { return Object.values(this.document.sessions).filter((record) => record.session.status === 'active' && record.session.id !== this.document.data.session?.id).sort((a, b) => b.editedAt.localeCompare(a.editedAt)); }
  async resume(id: string) {
    const session = this.document.sessions[id]?.session;
    if (!session || session.status !== 'active') throw new SyncError('这组练习已经完成或不再可用，请先同步。', 'data');
    await this.store.update((data) => { data.session = structuredClone(session); });
    this.track();
  }
  async exchange(client: GitHubSyncClient, active: () => boolean = () => true) {
    if (this.store.state !== 'ok') throw new SyncError('本地记录尚未可靠保存，已暂停云端同步。请先导出并修复本地存储。', 'data');
    const { branch } = await client.repository();
    for (let retry = 0; retry < 3; retry++) {
      const remote = await client.read(branch);
      if (!active()) return { pending: false, changed: false };
      this.track();
      const cloud = remote ? parseSyncDocument(remote.value) : seedSyncDocument();
      const merged = mergeSyncDocuments(this.document, cloud);
      const uploaded = canonical(merged);
      try {
        if (!remote || uploaded !== canonical(cloud)) {
          if (!active()) return { pending: false, changed: false };
          await client.write(branch, uploaded, remote?.sha);
        }
      } catch (error) {
        if (error instanceof SyncError && error.kind === 'conflict' && retry < 2) continue;
        throw error;
      }
      if (!active()) return { pending: false, changed: false };
      const before = canonical(this.store.snapshot());
      this.applying = true;
      try {
        await this.store.update((data) => {
          // Include user answers that arrived while GitHub was handling the request.
          this.document = mergeSyncDocuments(merged, captureLocal(this.document, data));
          Object.assign(data, this.document.data);
        });
      } finally { this.applying = false; }
      this.persist();
      if (this.store.state !== 'ok') throw new SyncError('云端已保留备份，但本机存储写入失败。请立即导出并整理空间。', 'data');
      return { pending: canonical(this.document) !== uploaded, changed: before !== canonical(this.store.snapshot()) };
    }
    throw new SyncError('另一台设备正在更新，稍后会自动重新合并。本地记录未丢失。', 'conflict');
  }
}
