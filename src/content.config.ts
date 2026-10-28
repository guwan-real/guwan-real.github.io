import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { knowledgeSchema } from './lib/cs-review/content-schema';

const csKnowledge = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cs-review/knowledge' }),
  schema: knowledgeSchema,
});
export const collections = { csKnowledge };
