import { DIFFICULTY_LABELS, MODULES, TYPE_LABELS, moduleTitle } from './catalogue';
import { createSession, emptyQuestionStats, masteryTimestamp, questionStats, questionStatsIndex, recordExam, recordPracticeAnswer, setQuestionFlag } from './study';
import { escapeHtml as e, fetchAnswer } from './browser';
import type { ReviewContext } from './browser';
import type { Answer, Attempt, PracticeMode, PublicQuestion, Session } from './types';

const modeLabels: Record<PracticeMode, string> = { random: '随机练习', chapter: '章节练习', knowledge: '知识点练习', mistakes: '错题专项', favorites: '收藏练习', exam: '模拟考试' };
const shuffle = <T>(input: T[]): T[] => {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};

export async function initPractice(ctx: ReviewContext): Promise<() => void> {
  const app = document.querySelector<HTMLElement>('#practice-app')!;
  const params = new URLSearchParams(location.search);
  let mode: PracticeMode = Object.hasOwn(modeLabels, params.get('mode') ?? '') ? params.get('mode') as PracticeMode : 'random';
  let moduleId = MODULES.some((m) => m.id === params.get('module')) ? params.get('module')! : '';
  let knowledgeId = ctx.knowledge.some((k) => k.knowledgeId === params.get('knowledge')) ? params.get('knowledge')! : '';
  if (knowledgeId) moduleId = ctx.knowledge.find((k) => k.knowledgeId === knowledgeId)!.moduleId;
  let fixedQuestionId = ctx.questions.some((q) => q.id === params.get('question')) ? params.get('question')! : '';
  let reviewScope = params.get('scope') ?? '';
  let recordFilter = ['unseen', 'done'].includes(params.get('record') ?? '') ? params.get('record')! : '';
  let count = '10';
  let setup = !(params.has('resume') || (!params.size && ctx.store.snapshot().session));
  let busy = false;
  let selectionPending = Promise.resolve();
  let generation = 0;
  const findQuestion = (id: string) => ctx.questions.find((q) => q.id === id);
  const selection = (session: Session, id: string) => session.selections[id] ?? [];
  const selectedOption = (value: string, current: string) => value === current ? ' selected' : '';
  function filteredQuestions() {
    const data = ctx.store.snapshot();
    const index = questionStatsIndex(data);
    const stats = (id: string) => index.get(id) ?? emptyQuestionStats();
    return ctx.questions.filter((q) => (!moduleId || q.moduleId === moduleId) && (!knowledgeId || q.knowledgeIds.includes(knowledgeId))
      && (!fixedQuestionId || q.id === fixedQuestionId)
      && (mode !== 'mistakes' || (reviewScope === 'history' ? stats(q.id).wrongCount > 0 : reviewScope === 'uncertain' ? stats(q.id).uncertain : stats(q.id).needsReview))
      && (mode !== 'favorites' || stats(q.id).favorite)
      && (recordFilter === 'unseen' ? stats(q.id).answeredCount === 0 : recordFilter === 'done' ? stats(q.id).answeredCount > 0 : true));
  }
  const chosenCount = () => Math.min(filteredQuestions().length, count === 'all' ? 2000 : Number(count));
  function renderSetup() {
    const available = filteredQuestions();
    const previous = ctx.store.snapshot().session;
    const topics = ctx.knowledge.filter((k) => !moduleId || k.moduleId === moduleId);
    app.innerHTML = `<header class="review-page-heading"><p class="review-eyebrow">PRACTICE / 开始练习</p><h1>专注眼前这一题。</h1><p class="review-lead">选一个范围，即刻开始。每次提交与标记都会保存在当前浏览器。</p></header>
      ${previous ? `<section class="review-resume"><div><h2>${previous.status === 'active' ? '有一组尚未完成的练习' : '上一次练习已完成'}</h2><p>${modeLabels[previous.mode]} · ${previous.questionIds.length} 题${previous.status === 'active' ? ' · 开始新练习会替换当前进度，已提交历史保留' : ''}</p></div><button class="review-button is-small" data-action="resume" data-focus="resume">${previous.status === 'active' ? '继续练习' : '回看本组结果'} →</button></section>` : ''}
      <aside class="review-notice"><p>当前题库共 <strong>${ctx.questions.length} 道题</strong>，${ctx.questions.every((q) => q.source.isExample) ? '均为自编自测，非官方真题。' : '来源与是否示例见各题标注。'}${fixedQuestionId ? '本次指定练习 1 道题。' : ''}</p></aside>
      <form class="review-config" id="practice-config"><div class="review-fields">
        <label class="review-field">练习方式<select name="mode" data-focus="config-mode">${Object.entries(modeLabels).map(([key, label]) => `<option value="${key}"${selectedOption(key, mode)}>${label}</option>`).join('')}</select></label>
        <label class="review-field">题目数量<select name="count" data-focus="config-count">${['5', '10', '20', '50', 'all'].map((n) => `<option value="${n}"${selectedOption(n, count)}>${n === 'all' ? '全部（最多 2,000）' : `${n} 题`}</option>`).join('')}</select></label>
        <label class="review-field">做题记录<select name="record" data-focus="config-record"><option value="">全部题目</option><option value="unseen"${selectedOption('unseen', recordFilter)}>未做过</option><option value="done"${selectedOption('done', recordFilter)}>已做过</option></select></label>
        <label class="review-field">所属章节<select name="module" data-focus="config-module"><option value="">全部章节</option>${MODULES.map((m) => `<option value="${m.id}"${selectedOption(m.id, moduleId)}>${m.title}</option>`).join('')}</select></label>
        <label class="review-field">关联知识点<select name="knowledge" data-focus="config-knowledge"><option value="">全部知识点</option>${topics.map((k) => `<option value="${e(k.knowledgeId)}"${selectedOption(k.knowledgeId, knowledgeId)}>${e(k.title)}</option>`).join('')}</select></label>
      </div><p class="review-caption">${mode === 'exam' ? '模拟考试不计时，每题 1 分，多选需全部选对。交卷前不显示正误与解析；未答题在交卷时计为错误。' : '练习可随时切题；提交后即时查看解析。多选题需全部选对，漏选或多选均记为错误。'}${mode === 'mistakes' ? reviewScope === 'history' ? ' 当前包含全部历史错题，已掌握的题也可以回看。' : reviewScope === 'uncertain' ? ' 当前仅练习标记不确定的题目。' : ' 本模式仅包含尚未手动标记掌握的历史错题。' : ''}</p>
      <div class="review-config-footer"><p class="review-muted" role="status">当前范围 ${available.length} 道可用题，本次练习 ${chosenCount()} 道。</p><button class="review-button is-primary" type="submit" ${available.length ? '' : 'disabled'}>${mode === 'exam' ? '开始模拟考试' : '开始练习'} →</button></div></form>
      ${available.length ? '' : `<div class="review-empty"><h2>这个范围暂时没有题目。</h2><p>${mode === 'mistakes' ? '暂无待复习错题。已掌握与曾经错过的题目仍可在错题本查看。' : mode === 'favorites' ? '还没有符合筛选条件的收藏题目。' : '试试其他章节或知识点；题库会随着手册和题目接入逐步扩充。'}</p></div>`}`;
  }
  function sessionInvalid(session: Session) {
    return session.questionIds.some((id) => {
      const q = findQuestion(id);
      return !q || q.revision !== session.revisions[id] || selection(session, id).some((selected) => !q.options.some((o) => o.id === selected));
    });
  }
  function answerMarkup(answer: Answer, q: PublicQuestion, attempt: Attempt) {
    const optionLabel = (ids: string[]) => ids.length ? ids.map((id) => q.type === 'boolean' ? (id === 'T' ? '正确' : '错误') : id).join('、') : '未作答';
    const stats = questionStats(ctx.store.snapshot(), q.id);
    return `<section class="review-answer ${attempt.correct ? '' : 'is-incorrect'}" aria-labelledby="answer-title"><div class="review-answer-result"><h2 id="answer-title" tabindex="-1">${attempt.correct ? '回答正确' : attempt.selectedOptionIds.length ? '这道题，再想一遍。' : '本题未作答'}</h2><span>正确答案：${e(optionLabel(answer.correctOptionIds))} · 你的答案：${e(optionLabel(attempt.selectedOptionIds))}</span></div>
      <div class="review-prose"><h3>解题过程</h3>${answer.analysisHtml}${answer.stepsHtml.length ? `<ol>${answer.stepsHtml.map((step) => `<li>${step}</li>`).join('')}</ol>` : ''}${answer.optionAnalysisHtml?.length ? `<h3>逐项辨析</h3><dl class="review-option-analysis">${answer.optionAnalysisHtml.map((option) => `<div><dt>${q.type === 'boolean' ? option.id === 'T' ? '正确' : '错误' : e(option.id)}</dt><dd>${option.html}</dd></div>`).join('')}</dl>` : ''}<h3>核心考点</h3>${answer.keyPointHtml}<h3>易错原因</h3>${answer.pitfallHtml}</div>
      <div class="review-answer-links">${q.knowledgeIds.map((id) => `<a class="review-text-link" href="${ctx.url(`knowledge/${id}/`)}">复习：${e(ctx.knowledge.find((k) => k.knowledgeId === id)?.title ?? id)} ↗</a>`).join('')}</div>
      ${stats.wrongCount ? `<div class="review-question-tools"><button class="review-button is-small" data-flag="mastered" data-focus="mastered" aria-pressed="${stats.mastered}">${stats.mastered ? '已掌握 · 移回待复习' : '我已理解，标记掌握'}</button><span class="review-caption">累计错 ${stats.wrongCount} 次，历史保留。</span></div>` : ''}</section>`;
  }
  async function render() {
    const currentGeneration = ++generation;
    const activeFocus = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
    const indexOpen = Boolean(app.querySelector<HTMLDetailsElement>('.review-question-index')?.open);
    const session = ctx.store.snapshot().session;
    if (setup || !session) { renderSetup(); app.setAttribute('aria-busy', 'false'); return; }
    if (sessionInvalid(session)) {
      app.innerHTML = '<div class="review-empty"><h1>题库已经更新。</h1><p>上次练习中有题目被更新或移除，无法沿用旧版本继续判分。历史提交仍然保留，请开始一组新练习。</p><button class="review-button is-primary" data-action="configure">选择新练习 →</button></div>';
      app.setAttribute('aria-busy', 'false'); return;
    }
    const q = findQuestion(session.questionIds[session.index])!;
    const data = ctx.store.snapshot();
    const isExam = session.mode === 'exam';
    const isFinished = session.status === 'finished';
    const committed = session.committed.includes(q.id);
    const canReveal = committed && (!isExam || isFinished);
    const attempt = data.attempts.find((a) => a.id === `${session.id}:${q.id}`);
    let answer: Answer | undefined;
    let answerError = '';
    if (canReveal) {
      try { answer = await fetchAnswer(ctx, q); }
      catch (error) { answerError = error instanceof Error ? error.message : '解析加载失败。'; }
    }
    if (currentGeneration !== generation) return;
    const completed = isExam ? session.questionIds.filter((id) => selection(session, id).length).length : session.committed.length;
    const selected = selection(session, q.id);
    const flag = data.flags[q.id];
    const stats = questionStats(data, q.id);
    const totalCorrect = data.attempts.filter((a) => a.sessionId === session.id && a.correct).length;
    app.innerHTML = `<div class="review-session-header"><div><h1>${modeLabels[session.mode]}</h1><p>${isExam && !isFinished ? '交卷后统一判分 · 选择自动保存' : '理解每一步，比记住答案更重要'}</p></div><div class="review-actions"><button class="review-button is-small" data-action="configure" data-focus="configure">练习设置</button>${isExam && !isFinished ? '<button class="review-button is-primary is-small" data-action="finish-exam" data-focus="finish-exam">交卷</button>' : ''}</div></div>
      ${isFinished ? `<section class="review-exam-result"><p class="review-eyebrow">${isExam ? 'EXAM RESULT' : 'SESSION COMPLETE'}</p><h2>${isExam ? '已交卷，可以逐题回看。' : '本组练习已完成。'}</h2><div class="review-exam-score">${totalCorrect}<small> / ${session.questionIds.length} ${isExam ? '分' : '题正确'}</small></div><p>每题 1 分，多选全对才得分；${isExam ? '未答题计错。' : '重复查看不会重复计入历史。'}题目${session.questionIds.every((id) => findQuestion(id)?.source.isExample) ? '均为自编练习，结果仅用于复习。' : '来源见各题。'}</p></section>` : ''}
      <div class="review-session-progress"><div><strong aria-live="polite">${String(session.index + 1).padStart(2, '0')} <span>/ ${String(session.questionIds.length).padStart(2, '0')}</span></strong><span>${completed} 题已${isExam ? '作答' : '提交'}</span></div><progress value="${completed}" max="${session.questionIds.length}" aria-label="练习完成进度"></progress></div>
      <div class="review-question-meta"><span class="review-tag">${TYPE_LABELS[q.type]}</span><span class="review-tag">${e(moduleTitle(q.moduleId))}</span><span class="review-tag">${DIFFICULTY_LABELS[q.difficulty]}</span>${q.source.isExample ? '<span class="review-tag is-example">自编自测 · 非官方真题</span>' : ''}</div>
      ${!isExam || isFinished ? `<p class="review-question-history">${stats.answeredCount ? `已做 ${stats.answeredCount} 次` : '未做过'}${stats.latest ? ` · 最近${stats.latest.correct ? '答对' : stats.latest.selectedOptionIds.length ? '答错' : '交卷未答'}` : ''}${stats.wrongCount ? ` · 历史错 ${stats.wrongCount} 次 · ${stats.mastered ? '已手动掌握' : '仍需复习'}` : ''}</p>` : ''}
      <div class="review-prose review-question-stem" id="question-stem" tabindex="-1">${q.stemHtml}</div>
      <fieldset class="review-options" aria-labelledby="question-stem"><legend class="review-sr-only">${q.type === 'multiple' ? '请选择所有正确选项' : '请选择一个答案'}</legend>${q.options.map((option, index) => {
        const isCorrect = Boolean(answer?.correctOptionIds.includes(option.id));
        const isWrong = Boolean(answer && selected.includes(option.id) && !isCorrect);
        return `<label class="review-option ${isCorrect ? 'is-correct' : isWrong ? 'is-wrong' : ''}"><input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="answer" value="${option.id}" data-focus="option-${option.id}" ${selected.includes(option.id) ? 'checked' : ''} ${committed ? 'disabled' : ''} /><span class="review-option-id" aria-hidden="true">${q.type === 'boolean' ? String(index + 1) : option.id}</span><span class="review-prose">${option.html}</span>${answer && (isCorrect || isWrong) ? `<span class="review-option-result">${isCorrect ? '正确项' : '你的选择'}</span>` : ''}</label>`;
      }).join('')}</fieldset>
      <div class="review-question-tools"><button class="review-button is-small" data-flag="uncertain" data-focus="uncertain" aria-pressed="${flag?.uncertain ?? false}">${flag?.uncertain ? '已标记不确定' : '标记不确定'}</button><button class="review-button is-small" data-flag="favorite" data-focus="favorite" aria-pressed="${flag?.favorite ?? false}">${flag?.favorite ? '已收藏' : '收藏题目'}</button></div>
      <p class="review-question-source">来源：${e(q.source.label)}${q.source.url ? ` · <a class="review-text-link" href="${e(q.source.url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>` : ''}</p>
      ${canReveal && answer && attempt ? answerMarkup(answer, q, attempt) : ''}
      ${answerError ? `<div class="review-feedback">${e(answerError)} <button class="review-button is-small" data-action="retry-answer">重试解析</button></div>` : ''}
      <div class="review-question-navigation"><button class="review-button" data-action="previous" data-focus="previous" ${session.index === 0 ? 'disabled' : ''}>← 上一题</button>${!isExam && !committed ? '<button class="review-button is-primary" data-action="submit" data-focus="submit">提交并看解析</button>' : ''}<button class="review-button ${committed || isExam ? 'is-primary' : ''}" data-action="next" data-focus="next" ${session.index === session.questionIds.length - 1 ? 'disabled' : ''}>下一题 →</button></div>
      <p class="review-keyboard-hint">1–9 选择 · Enter 提交练习 · ← → 切题（选项聚焦时使用原生方向键）</p>
      <details class="review-question-index" ${indexOpen ? 'open' : ''}><summary>答题卡 · ${isExam && !isFinished ? '只标记作答状态，交卷后显示正误' : '选择题号跳转，圆点表示不确定'}</summary><div class="review-question-grid">${session.questionIds.map((id, index) => {
        const done = isExam ? selection(session, id).length > 0 : session.committed.includes(id);
        const history = data.attempts.find((a) => a.id === `${session.id}:${id}`);
        const wrong = (!isExam || isFinished) && history && !history.correct;
        return `<button data-jump="${index}" data-focus="jump-${index}" class="${done ? 'is-answered' : ''} ${wrong ? 'is-wrong' : ''} ${data.flags[id]?.uncertain ? 'is-uncertain' : ''}" ${index === session.index ? 'aria-current="step"' : ''} aria-label="第 ${index + 1} 题，${done ? '已作答' : '未作答'}${wrong ? '，回答错误' : ''}${data.flags[id]?.uncertain ? '，不确定' : ''}">${index + 1}</button>`;
      }).join('')}</div></details>`;
    app.setAttribute('aria-busy', 'false');
    if (activeFocus) Array.from(app.querySelectorAll<HTMLElement>('[data-focus]')).find((el) => el.dataset.focus === activeFocus && !(el as HTMLButtonElement).disabled)?.focus({ preventScroll: true });
  }
  async function perform(action: () => void | Promise<void>, focusStem = false) {
    if (busy) return;
    busy = true; app.setAttribute('aria-busy', 'true');
    const activeFocus = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
    const controls = Array.from(app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')).map((el) => ({ el, disabled: el.disabled }));
    controls.forEach(({ el }) => { el.disabled = true; });
    try {
      await selectionPending; await action(); await render();
      ctx.notify('');
      if (focusStem) app.querySelector<HTMLElement>('#question-stem')?.focus({ preventScroll: true });
      else if (activeFocus) {
        const restore = Array.from(app.querySelectorAll<HTMLElement>('[data-focus]')).find((el) => el.dataset.focus === activeFocus && !(el as HTMLButtonElement).disabled);
        if (restore) restore.focus({ preventScroll: true });
        else if (activeFocus === 'submit' || activeFocus.startsWith('option-')) app.querySelector<HTMLElement>('#answer-title')?.focus({ preventScroll: true });
      }
    }
    catch (error) { ctx.notify(error instanceof Error ? error.message : '操作未完成，请重试。'); }
    finally {
      controls.forEach(({ el, disabled }) => { if (el.isConnected) el.disabled = disabled; });
      busy = false; app.setAttribute('aria-busy', 'false');
    }
  }
  async function startSession() {
    const previous = ctx.store.snapshot().session;
    if (previous?.status === 'active' && !(await ctx.confirm('开始一组新练习？', '当前未完成练习的选择将被替换。已经提交的答题历史、错题和收藏都会保留。', '开始新练习'))) return;
    let questions = filteredQuestions();
    if (mode === 'random' || mode === 'exam') questions = shuffle(questions);
    questions = questions.slice(0, chosenCount());
    const session = createSession(questions, mode, crypto.randomUUID());
    await ctx.store.update((data) => { data.session = session; });
    setup = false;
    history.replaceState(null, '', ctx.url('practice/?resume=1'));
  }
  async function submitNormal() {
    const session = ctx.store.snapshot().session;
    if (!session || session.mode === 'exam' || session.status === 'finished') return;
    const q = findQuestion(session.questionIds[session.index])!;
    if (session.committed.includes(q.id)) return;
    if (!selection(session, q.id).length) throw new Error('先选择一个答案，再查看解析。');
    const answer = await fetchAnswer(ctx, q);
    await ctx.store.sessionUpdate(session.id, (_, data) => recordPracticeAnswer(data, session.id, q, answer));
  }
  async function finishExam() {
    const session = ctx.store.snapshot().session;
    if (!session || session.mode !== 'exam' || session.status === 'finished') return;
    const unanswered = session.questionIds.filter((id) => !selection(session, id).length).length;
    if (!(await ctx.confirm('确认交卷？', `${unanswered ? `还有 ${unanswered} 题未作答，将计为错误。` : '所有题目均已作答。'}交卷后统一判分并保存本次全部记录，答案将无法修改。`, '交卷并查看结果'))) return;
    // This is the first place an active exam requests any answer file. All requests must succeed before writing any result.
    const answers = await Promise.all(session.questionIds.map((id) => fetchAnswer(ctx, findQuestion(id)!)));
    await ctx.store.sessionUpdate(session.id, (current, data) => {
      if (current.status === 'finished') return;
      if (JSON.stringify(current.selections) !== JSON.stringify(session.selections)) throw new Error('其他页面刚刚更改了本次作答，请复核后再次交卷。');
      recordExam(data, session.id, ctx.questions, answers);
    });
  }
  app.addEventListener('submit', (event) => { event.preventDefault(); void perform(startSession, true); });
  app.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (setup && target.closest('#practice-config')) {
      const form = app.querySelector<HTMLFormElement>('#practice-config')!;
      const fields = new FormData(form);
      mode = fields.get('mode') as PracticeMode; moduleId = fields.get('module') as string; knowledgeId = fields.get('knowledge') as string; count = fields.get('count') as string;
      recordFilter = fields.get('record') as string;
      if (mode === 'chapter' && !moduleId) moduleId = MODULES[0].id;
      if (knowledgeId && ctx.knowledge.find((k) => k.knowledgeId === knowledgeId)?.moduleId !== moduleId && moduleId) knowledgeId = '';
      if (mode === 'knowledge' && !knowledgeId) knowledgeId = ctx.knowledge.find((k) => !moduleId || k.moduleId === moduleId)?.knowledgeId ?? '';
      const focus = target.dataset.focus; renderSetup();
      Array.from(app.querySelectorAll<HTMLElement>('[data-focus]')).find((el) => el.dataset.focus === focus)?.focus();
      return;
    }
    if (target.name === 'answer') {
      const session = ctx.store.snapshot().session;
      if (!session || session.status === 'finished') return;
      const id = session.questionIds[session.index];
      const selected = Array.from(app.querySelectorAll<HTMLInputElement>('input[name="answer"]:checked')).map((input) => input.value);
      selectionPending = selectionPending.then(async () => {
        await ctx.store.sessionUpdate(session.id, (current) => { if (current.status === 'active' && !current.committed.includes(id)) current.selections[id] = selected; });
      }).catch((error) => ctx.notify(error instanceof Error ? error.message : '选择未能保存。'));
      // Avoid replacing focused option elements while the user is selecting multiple choices.
      void selectionPending.then(() => {
        const current = ctx.store.snapshot().session;
        if (!current || current.id !== session.id || current.index !== session.index) return;
        const progress = app.querySelector<HTMLProgressElement>('progress');
        const label = app.querySelector<HTMLElement>('.review-session-progress > div > span');
        const answered = current.mode === 'exam' ? current.questionIds.filter((key) => selection(current, key).length).length : current.committed.length;
        if (progress) progress.value = answered;
        if (label) label.textContent = `${answered} 题已${current.mode === 'exam' ? '作答' : '提交'}`;
        const grid = app.querySelector<HTMLElement>(`[data-jump="${current.index}"]`);
        if (grid && current.mode === 'exam') grid.classList.toggle('is-answered', selection(current, id).length > 0);
      });
    }
  });
  app.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || (button.type === 'submit' && button.closest('#practice-config')) || button.disabled || busy) return;
    const action = button.dataset.action;
    if (action === 'configure') {
      setup = true; fixedQuestionId = ''; reviewScope = ''; history.replaceState(null, '', ctx.url('practice/')); void render(); return;
    }
    if (action === 'resume') { setup = false; history.replaceState(null, '', ctx.url('practice/?resume=1')); void render(); return; }
    if (action === 'submit') { void perform(submitNormal); return; }
    if (action === 'finish-exam') { void perform(finishExam); return; }
    if (action === 'retry-answer') { void perform(() => {}); return; }
    const session = ctx.store.snapshot().session;
    if (!session) return;
    const id = session.questionIds[session.index];
    if (action === 'previous' || action === 'next' || button.dataset.jump !== undefined) {
      const next = button.dataset.jump !== undefined ? Number(button.dataset.jump) : session.index + (action === 'next' ? 1 : -1);
      if (next < 0 || next >= session.questionIds.length) return;
      void perform(() => ctx.store.sessionUpdate(session.id, (current) => { current.index = next; }), true);
    }
    if (button.dataset.flag) void perform(() => ctx.store.update((data) => {
      const stats = questionStats(data, id);
      if (button.dataset.flag === 'favorite') setQuestionFlag(data, id, { favorite: !stats.favorite });
      if (button.dataset.flag === 'uncertain') setQuestionFlag(data, id, { uncertain: !stats.uncertain });
      if (button.dataset.flag === 'mastered') setQuestionFlag(data, id, { masteredAt: stats.mastered ? null : masteryTimestamp(data, id) });
    }));
  });
  document.addEventListener('keydown', (event) => {
    if (setup || busy || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
    if (target instanceof HTMLInputElement && !['radio', 'checkbox'].includes(target.type)) return;
    if (/^[1-9]$/.test(event.key)) {
      const input = app.querySelectorAll<HTMLInputElement>('input[name="answer"]')[Number(event.key) - 1];
      if (!input || input.disabled) return;
      event.preventDefault(); input.checked = input.type === 'radio' || !input.checked; input.focus(); input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (event.key === 'Enter' && !(target instanceof HTMLButtonElement) && ctx.store.snapshot().session?.mode !== 'exam') { event.preventDefault(); void perform(submitNormal); }
    if (!(target instanceof HTMLInputElement) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const control = app.querySelector<HTMLButtonElement>(`[data-action="${event.key === 'ArrowLeft' ? 'previous' : 'next'}"]`);
      if (control && !control.disabled) { event.preventDefault(); control.click(); }
    }
  });
  if (params.get('start') === '1' && ctx.store.snapshot().session?.status !== 'active' && filteredQuestions().length) await startSession();
  await render();
  return () => { void render(); };
}
