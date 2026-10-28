import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import matter from 'gray-matter';
import { validateCatalogue, validateExplanations } from '../src/lib/cs-review/content-schema';

const knowledgeDirectory = new URL('../src/content/cs-review/knowledge/', import.meta.url);
const questionDirectory = new URL('../src/content/cs-review/questions/', import.meta.url);
const knowledge = await Promise.all((await readdir(knowledgeDirectory)).filter((name) => name.endsWith('.md')).map(async (name) => {
  const { data, content } = matter(await readFile(new URL(name, knowledgeDirectory), 'utf8'));
  if (data.knowledgeId !== basename(name, '.md')) throw new Error(`文件名与知识点 ID 不一致：${name}`);
  if (!content.trim()) throw new Error(`知识点正文为空：${name}`);
  return data;
}));
const questions = (await Promise.all((await readdir(questionDirectory)).filter((name) => name.endsWith('.json')).map(async (name) => {
  const value: unknown = JSON.parse(await readFile(new URL(name, questionDirectory), 'utf8'));
  if (!Array.isArray(value)) throw new Error(`题库文件必须包含 JSON 数组：${name}`);
  return value;
}))).flat();
const catalogue = validateCatalogue(knowledge, questions);
const explanationDirectory = new URL('../src/content/cs-review/explanations/', import.meta.url);
const explanations = await Promise.all((await readdir(explanationDirectory)).filter((name) => name.endsWith('.md')).map(async (name) => {
  const { data, content } = matter(await readFile(new URL(name, explanationDirectory), 'utf8'));
  if (data.knowledgeId !== basename(name, '.md')) throw new Error(`扩展讲义文件名与 ID 不一致：${name}`);
  if (!content.trim()) throw new Error(`扩展讲义正文为空：${name}`);
  return data;
}));
validateExplanations(catalogue.knowledge, explanations);
console.log(`CS Review 内容校验通过：${catalogue.knowledge.length} 个知识点，${explanations.length} 篇基础讲义，${catalogue.questions.length} 道题目。`);
