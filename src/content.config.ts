import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { knowledgeSchema, explanationSchema } from './lib/cs-review/content-schema';

const csKnowledge = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cs-review/knowledge' }),
  schema: knowledgeSchema,
});
const csExplanations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cs-review/explanations' }),
  schema: explanationSchema,
});
export const collections = { csKnowledge, csExplanations };
