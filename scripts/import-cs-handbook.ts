import { readFile, writeFile } from 'node:fs/promises';
import { parseHandbook, chapterBody } from '../src/lib/cs-review/handbook-source';
import syllabus from '../src/content/cs-review/syllabus.json';

const source = await readFile(new URL('../src/content/cs-review/handbook.md', import.meta.url), 'utf8');
const { sections, recipes } = parseHandbook(source);
if (sections.size !== 48 || syllabus.length !== 48) throw new Error('手册与大纲必须包含完整的 1–48 项。');
for (const item of syllabus) {
  const section = sections.get(item.number);
  if (!section?.body) throw new Error(`手册缺少第 ${item.number} 节`);
  const selectedRecipes = item.recipes.map((id) => {
    const recipe = recipes.get(id);
    if (!recipe) throw new Error(`缺少专项 ${id}`);
    return recipe;
  });
  const data = {
    knowledgeId: item.knowledgeId, moduleId: item.moduleId,
    title: `${String(item.number).padStart(2, '0')}. ${item.title}`,
    description: section.title.replace(/^\d+\. /, ''),
    order: item.number, status: 'handbook', syllabusNumber: item.number,
    source: `《电网招聘_计算机类_强化复习手册》第 ${item.number} 节${item.recipes.length ? `及专项 ${item.recipes.join('、')}` : ''}；对应国网 2027 大纲专业知识第 ${item.number} 项。`,
    tags: [item.title, '国网2027', '复习手册'],
  };
  const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  await writeFile(new URL(`../src/content/cs-review/knowledge/${item.knowledgeId}.md`, import.meta.url), `---\n${frontmatter}\n---\n\n${chapterBody(section, selectedRecipes).trimEnd()}\n`);
}
console.log(`已按原文接入 ${sections.size} 节，保留 ${recipes.size} 个专项；原始手册未修改。`);
