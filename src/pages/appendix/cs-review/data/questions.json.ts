import type { APIRoute } from 'astro';
import { getPublicQuestions } from '../../../../lib/cs-review/content';
export const GET: APIRoute = async () => new Response(JSON.stringify(await getPublicQuestions()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
