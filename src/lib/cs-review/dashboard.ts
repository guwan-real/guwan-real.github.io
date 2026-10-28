import { MODULES, TYPE_LABELS, moduleTitle } from './catalogue';
import { createBackup, emptyQuestionStats, mergeStudyData, parseBackup, questionStats, questionStatsIndex, setQuestionFlag } from './study';
import { downloadJson, escapeHtml as e, formatDate, preserveFocus } from './browser';
import type { ReviewContext } from './browser';
import type { PublicQuestion, StudyData } from './types';

const plainStem = (q: PublicQuestion) => new DOMParser().parseFromString(q.stemHtml, 'text/html').body.textContent?.trim() ?? q.id;
const moduleOptions = (selected: string) => '<option value="">全部章节</option>' + MODULES.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${m.title}</option>`).join('');
const practiceLink = (ctx: ReviewContext, id: string) => ctx.url(`practice/?question=${id}&mode=random&start=1`);
const percent = (correct: number, total: number) => total ? `${Math.round(correct * 1000 / total) / 10}%` : '—';

export function initMistakes(ctx: ReviewContext) {
  const app = document.querySelector<HTMLElement>('#mistakes-app')!;
  let view = 'pending';
  let moduleId = '';
  let page = 0;
  const pageSize = 20;
  const views = { pending: '仍需复习', history: '全部历史错题', done: '已做记录', favorites: '收藏', uncertain: '不确定' };
  function render() {
    preserveFocus(app, () => {
      const data = ctx.store.snapshot();
      const index = questionStatsIndex(data);
      const rows = ctx.questions.map((q) => ({ q, stats: index.get(q.id) ?? emptyQuestionStats() })).filter(({ q, stats }) => (!moduleId || q.moduleId === moduleId)
        && (view === 'pending' ? stats.needsReview : view === 'history' ? stats.wrongCount > 0 : view === 'done' ? stats.answeredCount > 0 : view === 'favorites' ? stats.favorite : stats.uncertain))
        .sort((a, b) => b.stats.wrongCount - a.stats.wrongCount || (b.stats.latest?.answeredAt ?? '').localeCompare(a.stats.latest?.answeredAt ?? ''));
      page = Math.max(0, Math.min(page, Math.ceil(rows.length / pageSize) - 1));
      const scope = view === 'favorites' ? '' : `&scope=${view}`;
      const practice = ctx.url(`practice/?mode=${view === 'done' ? 'random&record=done' : view === 'favorites' ? 'favorites' : 'mistakes'}${view === 'done' ? '' : scope}${moduleId ? `&module=${moduleId}` : ''}&start=1`);
      app.innerHTML = `<div class="review-tabs" role="group" aria-label="记录类型">${Object.entries(views).map(([key, label]) => `<button data-view="${key}" data-focus="view-${key}" aria-pressed="${view === key}">${label}</button>`).join('')}</div>
        <div class="review-filter-row"><label class="review-field">按章节筛选<select data-mistake-module data-focus="mistake-module">${moduleOptions(moduleId)}</select></label>${rows.length ? `<a class="review-button is-primary is-small" href="${practice}">练习这组题 →</a>` : ''}</div>
        <p class="review-caption" role="status">${Object.hasOwn(views, view) ? views[view as keyof typeof views] : ''} · ${rows.length} 道题。${view === 'done' ? '提交过有效选择的题目会标记为已做；模拟考试未答题仍按未做筛选，同时保留交卷错误记录。' : '手动掌握后仍保留错误次数；以后再次做错会重新进入待复习。'}</p>
        ${rows.length ? rows.slice(page * pageSize, (page + 1) * pageSize).map(({ q, stats }) => `<article class="review-mistake"><div class="review-mistake-header"><div class="review-question-meta"><span class="review-tag">${e(moduleTitle(q.moduleId))}</span><span class="review-tag">${TYPE_LABELS[q.type]}</span>${q.source.isExample ? '<span class="review-tag is-example">自测题</span>' : ''}${stats.mastered ? '<span class="review-tag">已手动掌握</span>' : ''}</div><a class="review-text-link" href="${practiceLink(ctx, q.id)}">重新练习 ↗</a></div>
          <div class="review-prose">${q.stemHtml}</div><div class="review-mistake-footer"><p class="review-caption">累计错 ${stats.wrongCount} 次 / 提交 ${stats.attempts} 次<br />最近：${stats.latest ? `${stats.latest.correct ? '正确' : stats.latest.selectedOptionIds.length ? '错误' : '未作答（模拟交卷）'} · ${formatDate(stats.latest.answeredAt)}` : '尚未提交'}</p><div class="review-question-tools">${stats.wrongCount ? `<button class="review-button is-small" data-id="${q.id}" data-mistake-flag="mastered" data-focus="mastered-${q.id}" aria-pressed="${stats.mastered}">${stats.mastered ? '移回待复习' : '标记已掌握'}</button>` : ''}<button class="review-button is-small" data-id="${q.id}" data-mistake-flag="favorite" data-focus="favorite-${q.id}" aria-pressed="${stats.favorite}">${stats.favorite ? '已收藏' : '收藏'}</button>${stats.uncertain ? `<button class="review-button is-small" data-id="${q.id}" data-mistake-flag="uncertain" data-focus="uncertain-${q.id}">移除不确定</button>` : ''}</div></div></article>`).join('') : `<div class="review-empty"><h2>${view === 'pending' ? '此刻，没有待复习的错题。' : '这里还没有记录。'}</h2><p>${view === 'pending' ? '新错题会自动出现在这里。答对一次不会删除历史；确认理解后，你可以手动标记掌握。' : '练习时可以收藏或标记不确定；每一次错误都会保留在历史错题中。'}</p><a class="review-button is-primary" href="${ctx.url('practice/')}">开始练习 →</a></div>`}
        ${rows.length > pageSize ? `<div class="review-actions"><button class="review-button is-small" data-record-page="previous" ${page ? '' : 'disabled'}>上一页</button><span class="review-caption">${page + 1} / ${Math.ceil(rows.length / pageSize)}</span><button class="review-button is-small" data-record-page="next" ${((page + 1) * pageSize) < rows.length ? '' : 'disabled'}>下一页</button></div>` : ''}`;
      app.setAttribute('aria-busy', 'false');
    });
  }
  app.addEventListener('change', (event) => { const target = event.target as HTMLSelectElement; if (target.hasAttribute('data-mistake-module')) { moduleId = target.value; page = 0; render(); } });
  app.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.view) { view = button.dataset.view; page = 0; render(); }
    if (button.dataset.recordPage) { page += button.dataset.recordPage === 'next' ? 1 : -1; render(); }
    const id = button.dataset.id;
    if (id && button.dataset.mistakeFlag) {
      try {
        await ctx.store.update((data) => {
          const stats = questionStats(data, id);
          if (button.dataset.mistakeFlag === 'mastered') setQuestionFlag(data, id, { masteredAt: stats.mastered ? null : new Date().toISOString() });
          if (button.dataset.mistakeFlag === 'favorite') setQuestionFlag(data, id, { favorite: !stats.favorite });
          if (button.dataset.mistakeFlag === 'uncertain') setQuestionFlag(data, id, { uncertain: false });
        });
        render();
      } catch (error) { ctx.notify(error instanceof Error ? error.message : '更新失败。'); }
    }
  });
  render(); return render;
}

export function initProgress(ctx: ReviewContext) {
  const app = document.querySelector<HTMLElement>('#progress-app')!;
  const management = document.querySelector<HTMLElement>('#data')!;
  let incoming: StudyData | null = null;
  let importName = '';
  function render() {
    const data = ctx.store.snapshot();
    const currentIds = new Set(ctx.questions.map((q) => q.id));
    const currentAttempts = data.attempts.filter((a) => currentIds.has(a.questionId));
    const correct = data.attempts.filter((a) => a.correct).length;
    const index = questionStatsIndex(data);
    const questionById = new Map(ctx.questions.map((q) => [q.id, q]));
    const practicedKnowledge = new Set(currentAttempts.filter((a) => a.selectedOptionIds.length > 0).flatMap((a) => questionById.get(a.questionId)?.knowledgeIds ?? []));
    const knownStats = ctx.questions.map((q) => ({ q, stats: index.get(q.id) ?? emptyQuestionStats() }));
    const needingReview = knownStats.filter(({ stats }) => stats.needsReview);
    const reviewed = ctx.knowledge.filter((k) => data.reviewed[k.knowledgeId]);
    const unpracticed = ctx.knowledge.filter((k) => !practicedKnowledge.has(k.knowledgeId));
    const highFrequency = knownStats.filter(({ stats }) => stats.wrongCount > 0).sort((a, b) => b.stats.wrongCount - a.stats.wrongCount).slice(0, 8);
    const weaknesses = ctx.knowledge.map((k) => ({ k, count: needingReview.filter(({ q }) => q.knowledgeIds.includes(k.knowledgeId)).length })).filter((row) => row.count).sort((a, b) => b.count - a.count);
    const recentDays = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (6 - i)); return date; });
    const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    preserveFocus(app, () => {
      app.innerHTML = `<dl class="review-metrics"><div><dt>累计提交</dt><dd>${data.attempts.length}<small>次</small></dd></div><div><dt>提交正确率</dt><dd>${percent(correct, data.attempts.length)}</dd></div><div><dt>主动标记已复习</dt><dd>${reviewed.length}<small>/ ${ctx.knowledge.length} 知识点</small></dd></div><div><dt>仍需复习的错题</dt><dd>${needingReview.length}<small>道</small></dd></div></dl>
        <p class="review-caption">累计提交包含重复练习和模拟考试未答题。正确率 = 正确提交次数 / 全部提交次数；它反映历史表现，不代表掌握率。已移除题目的 ${data.attempts.length - currentAttempts.length} 条历史保留在总数与备份中。</p>
        <section class="review-section"><div class="review-section-heading"><h2>最近七天</h2><span class="review-muted">按当前设备日期统计</span></div><div class="review-recent-days">${recentDays.map((date) => {
          const attempts = data.attempts.filter((a) => dayKey(new Date(a.answeredAt)) === dayKey(date));
          return `<div class="${attempts.length ? 'is-active' : ''}"><time datetime="${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}">${date.getMonth() + 1}/${date.getDate()}</time><strong>${attempts.length}</strong><small>提交</small></div>`;
        }).join('')}</div></section>
        <section class="review-section"><h2>各模块练习情况</h2><div class="review-table-wrap"><table class="review-table"><caption class="review-sr-only">各模块累计提交、正确次数、正确率与题目覆盖</caption><thead><tr><th scope="col">模块</th><th scope="col">提交 / 正确</th><th scope="col">正确率</th><th scope="col">练过 / 现有题</th></tr></thead><tbody>${MODULES.map((module) => {
          const ids = new Set(ctx.questions.filter((q) => q.moduleId === module.id).map((q) => q.id));
          const attempts = currentAttempts.filter((a) => ids.has(a.questionId));
          const right = attempts.filter((a) => a.correct).length;
          return `<tr><th scope="row"><a href="${ctx.url(`knowledge/#${module.id}`)}">${module.short}</a></th><td>${attempts.length} / ${right}</td><td>${percent(right, attempts.length)}</td><td>${new Set(attempts.filter((a) => a.selectedOptionIds.length > 0).map((a) => a.questionId)).size} / ${ids.size}</td></tr>`;
        }).join('')}</tbody></table></div><p class="review-caption">当前模块统计按现有题目 ID 归组，包含这些题目的历史版本。练过题数按已提交有效选择的 ID 去重，模拟交卷未答题不计入覆盖；小样本正确率只能作参考。</p></section>
        <section class="review-section"><h2>优先回看的知识点</h2><p class="review-caption">按当前待复习题数排序，仅作为复习优先级提示。</p><div class="review-status-list">${weaknesses.length ? weaknesses.map(({ k, count }) => `<a href="${ctx.url(`knowledge/${k.knowledgeId}/`)}"><span>${e(k.title)}</span><span class="review-muted">${count} 道待复习 ↗</span></a>`).join('') : '<p class="review-caption">暂无待复习关联记录。这不等于所有知识点已经掌握。</p>'}</div></section>
        <section class="review-section"><h2>高频错题</h2><div class="review-status-list">${highFrequency.length ? highFrequency.map(({ q, stats }) => `<a href="${practiceLink(ctx, q.id)}"><span>${e(plainStem(q).slice(0, 66))}${plainStem(q).length > 66 ? '…' : ''}<p>${e(moduleTitle(q.moduleId))} · ${stats.mastered ? '已手动掌握，历史保留' : '仍需复习'}</p></span><span class="review-muted">错 ${stats.wrongCount} 次 ↗</span></a>`).join('') : '<p class="review-caption">尚无错误记录，做错的题会自动收录。</p>'}</div></section>
        <details class="review-details"><summary>尚未练习的知识点 · ${unpracticed.length} 个</summary><div class="review-status-list">${unpracticed.map((k) => `<a href="${ctx.url(`knowledge/${k.knowledgeId}/`)}"><span>${e(k.title)}</span><span class="review-muted">先复习 ↗</span></a>`).join('') || '<p class="review-caption">当前每个知识点都已有提交记录。</p>'}</div></details>
        <details class="review-details"><summary>主动标记已复习 · ${reviewed.length} 个</summary><div class="review-status-list">${reviewed.map((k) => `<a href="${ctx.url(`knowledge/${k.knowledgeId}/`)}"><span>${e(k.title)}</span><span class="review-muted">${formatDate(data.reviewed[k.knowledgeId])}</span></a>`).join('') || '<p class="review-caption">阅读知识页后，可以主动点击“标记已复习”。</p>'}</div></details>
        `;
      app.setAttribute('aria-busy', 'false');
    });
    management.querySelector<HTMLElement>('[data-data-action="raw"]')!.hidden = ctx.store.state === 'ok' || !ctx.store.rawRecord();
    management.querySelector<HTMLElement>('[data-import-preview]')!.innerHTML = incoming ? `<div class="review-import-preview" role="status"><h3>确认恢复：${e(importName)}</h3><p>备份包含 ${incoming.attempts.length} 次提交、${Object.keys(incoming.flags).length} 道题目标记、${Object.keys(incoming.reviewed).length} 个复习标记。</p><p>将与当前记录合并，重复提交只保留一份；按修改时间保留较新的标记。当前练习优先保留，历史中已移除的题目也会保留。请先导出当前记录备份。</p><div class="review-actions"><button class="review-button is-primary is-small" data-data-action="apply">合并恢复</button><button class="review-button is-small" data-data-action="cancel">取消</button></div></div>` : '';
  }
  management.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'review-import') return;
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MiB。');
      incoming = parseBackup(JSON.parse(await file.text())); importName = file.name; input.value = ''; render();
      management.querySelector('.review-import-preview')?.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (error) { incoming = null; input.value = ''; render(); ctx.notify(error instanceof Error ? error.message : '无法读取备份。'); }
  });
  management.addEventListener('click', async (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-data-action]')?.dataset.dataAction;
    if (!action) return;
    const date = new Date().toISOString().slice(0, 10);
    try {
      if (action === 'export') { downloadJson(`cs-review-${date}.json`, createBackup(ctx.store.snapshot())); ctx.notify('学习记录已导出。请检查浏览器下载列表。', true); }
      if (action === 'raw') { const raw = ctx.store.rawRecord(); if (raw) downloadJson(`cs-review-original-${date}.json`, raw); }
      if (action === 'cancel') { incoming = null; render(); }
      if (action === 'apply' && incoming) {
        if (ctx.store.state !== 'ok') throw new Error('当前本地存储存在异常。请先导出学习记录与原始记录，再清空本地记录后重新选择备份恢复。');
        const backup = incoming;
        await ctx.store.update((data) => Object.assign(data, mergeStudyData(data, backup)));
        incoming = null; render();
        if (ctx.store.state === 'ok') ctx.notify('记录已合并恢复，重复提交没有重复计数。', true);
      }
      if (action === 'clear' && await ctx.confirm('清空本地学习记录？', '将删除本浏览器中全部答题历史、当前练习、错题、收藏与复习标记。请先导出备份；清空后无法直接撤销。', '清空记录')) {
        await ctx.store.clear(); incoming = null; render();
        if (ctx.store.state === 'ok') ctx.notify('本浏览器的学习记录已清空。', true);
      }
    } catch (error) { ctx.notify(error instanceof Error ? error.message : '操作失败，原有记录已保留。'); }
  });
  render();
  if (location.hash === '#data') management.scrollIntoView({ block: 'start', behavior: 'instant' });
  return render;
}
