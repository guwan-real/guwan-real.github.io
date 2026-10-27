import type { APIRoute } from 'astro';
import { getReviewContent } from '../../../../lib/cs-review/content';
export const GET: APIRoute = async () => new Response(JSON.stringify((await getReviewContent()).entries.map((entry) => ({
  id: entry.data.knowledgeId, moduleId: entry.data.moduleId, title: entry.data.title, description: entry.data.description,
  text: (entry.body ?? '').replace(/[#*`$|]/g, ''),
}))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
