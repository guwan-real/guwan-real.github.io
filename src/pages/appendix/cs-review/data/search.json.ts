import type { APIRoute } from 'astro';
import { getReviewContent } from '../../../../lib/cs-review/content';
export const GET: APIRoute = async () => {
  const { entries, explanations } = await getReviewContent();
  const lessons = new Map(explanations.map((entry) => [entry.data.knowledgeId, entry]));
  return new Response(JSON.stringify(entries.map((entry) => ({
    id: entry.data.knowledgeId, moduleId: entry.data.moduleId, title: entry.data.title,
    description: lessons.get(entry.data.knowledgeId)?.data.description ?? entry.data.description,
    text: `${entry.body ?? ''}\n${lessons.get(entry.data.knowledgeId)?.body ?? ''}`.replace(/[#*`$|]/g, ''),
  }))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
