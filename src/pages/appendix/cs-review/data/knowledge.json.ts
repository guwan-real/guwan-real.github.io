import type { APIRoute } from 'astro';
import { getReviewContent } from '../../../../lib/cs-review/content';
export const GET: APIRoute = async () => new Response(JSON.stringify((await getReviewContent()).knowledge), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
