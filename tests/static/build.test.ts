import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import type { Answer, PublicQuestion } from '../../src/lib/cs-review/types';

const dist = new URL('../../dist/', import.meta.url);
const root = new URL('appendix/cs-review/', dist);
const questions: PublicQuestion[] = JSON.parse(await readFile(new URL('data/questions.json', root), 'utf8'));
const paths = await readdir(dist, { recursive: true });
test('every review route, internal link and bundled script exists as a static file', async () => {
  const pages = paths.filter((path) => path.startsWith('appendix/cs-review/') && path.endsWith('.html'));
  assert.ok(pages.length >= 5);
  for (const page of pages) {
    const html = await readFile(new URL(page, dist), 'utf8');
    for (const [, value] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(value, `https://static.invalid/${page}`);
      if (url.origin !== 'https://static.invalid' || (!url.pathname.startsWith('/appendix/cs-review/') && !url.pathname.startsWith('/_astro/'))) continue;
      const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      const file = new URL(`.${path}`, dist);
      await assert.doesNotReject(() => access(file), `${page}: missing ${value}`);
      if (url.hash && path.endsWith('.html')) {
        const target = await readFile(file, 'utf8');
        assert.ok(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${page}: missing anchor ${value}`);
      }
    }
  }
});
test('KaTeX fonts and stylesheet asset paths resolve locally', async () => {
  for (const css of paths.filter((path) => path.endsWith('.css'))) {
    const content = await readFile(new URL(css, dist), 'utf8');
    for (const [, value] of content.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      if (value.startsWith('data:') || /^https?:/.test(value)) continue;
      const assetUrl = new URL(value, `https://static.invalid/${css}`);
      const target = new URL(`.${assetUrl.pathname}`, dist);
      await assert.doesNotReject(() => access(target), `${css}: missing ${value}`);
    }
  }
});
test('public questions contain no answer or explanation payload', () => {
  const forbidden = ['correctOptionIds', 'explanation', 'analysisHtml', 'stepsHtml', 'keyPointHtml', 'pitfallHtml', 'optionAnalysisHtml'];
  const json = JSON.stringify(questions);
  for (const key of forbidden) assert.ok(!json.includes(`"${key}"`), key);
  assert.ok(questions.every((q) => q.stemHtml && q.options.length >= 2));
});
test('all answer files match the published question revisions and options', async () => {
  for (const q of questions) {
    const answer: Answer = JSON.parse(await readFile(new URL(`data/answers/${q.id}.json`, root), 'utf8'));
    assert.equal(answer.id, q.id); assert.equal(answer.revision, q.revision);
    assert.ok(answer.correctOptionIds.length && answer.correctOptionIds.every((id) => q.options.some((o) => o.id === id)));
    assert.ok(answer.analysisHtml && answer.keyPointHtml && answer.pitfallHtml);
    if (q.id.startsWith('review-extra-') || q.id.startsWith('review-drill-')) {
      assert.deepEqual(answer.optionAnalysisHtml?.map((o) => o.id), q.options.map((o) => o.id));
      assert.ok(answer.optionAnalysisHtml?.every((o) => o.html));
    }
  }
});
test('exam HTML and client bundles do not embed question answers', async () => {
  const html = await readFile(new URL('practice/index.html', root), 'utf8');
  assert.doesNotMatch(html, /正确答案|example-complement-01/);
  const scripts = await Promise.all(paths.filter((path) => path.endsWith('.js')).map((path) => readFile(new URL(path, dist), 'utf8')));
  assert.doesNotMatch(scripts.join('\n'), /01111111|69\\bmod64|第二趟插入的是原序列/);
});
test('homepage retains its own stylesheet and review styles are isolated', async () => {
  const home = await readFile(new URL('index.html', dist), 'utf8');
  const review = await readFile(new URL('index.html', root), 'utf8');
  const reviewCss = review.match(/href="([^" ]+\.css)"/)?.[1];
  assert.ok(reviewCss); assert.ok(!home.includes(reviewCss));
  assert.match(home, /Appendix \/ CS Review/); assert.match(home, /hero-workbench/);
  assert.match(review, /class="cs-review"/);
});
test('full handbook, original Markdown download and PDF are published', async () => {
  const page = await readFile(new URL('handbook/index.html', root), 'utf8');
  assert.match(page, /高频题型决策表/); assert.match(page, /48 项逐项复习勾选表/); assert.match(page, /文档与大纲关系/);
  const source = await readFile(new URL('../../src/content/cs-review/handbook.md', import.meta.url), 'utf8');
  assert.equal(await readFile(new URL('resources/handbook.md', root), 'utf8'), source);
  const pdf = await readFile(new URL('resources/sgcc-2027-computer-syllabus.pdf', root));
  assert.ok(pdf.subarray(0, 4).toString() === '%PDF');
});
