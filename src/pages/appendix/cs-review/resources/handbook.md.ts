import type { APIRoute } from 'astro';
import source from '../../../../content/cs-review/handbook.md?raw';
export const GET: APIRoute = () => new Response(source, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
