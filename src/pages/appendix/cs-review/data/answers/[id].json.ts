import type { APIRoute } from 'astro';
import { getReviewContent, getAnswer } from '../../../../../lib/cs-review/content';
export async function getStaticPaths() {
  return (await getReviewContent()).questions.map((q) => ({ params: { id: q.id } }));
}
export const GET: APIRoute = async ({ params }) => new Response(JSON.stringify(await getAnswer(params.id!)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
