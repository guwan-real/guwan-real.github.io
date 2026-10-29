import type { KnowledgeMeta, PublicQuestion, Session } from './types';

export function sessionKnowledge(session: Session, questions: PublicQuestion[], knowledge: KnowledgeMeta[]): KnowledgeMeta | undefined {
  if (session.mode !== 'knowledge') return;
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const matches = knowledge.filter((topic) => session.questionIds.every((id) => questionById.get(id)?.knowledgeIds.includes(topic.knowledgeId)));
  // Older v1 sessions have no topic metadata. Infer only an unambiguous common topic.
  return session.knowledgeId ? matches.find((topic) => topic.knowledgeId === session.knowledgeId) : matches.length === 1 ? matches[0] : undefined;
}

export function nextKnowledge(currentId: string, knowledge: KnowledgeMeta[]): KnowledgeMeta | undefined {
  const ordered = [...knowledge].sort((a, b) => a.order - b.order);
  const position = ordered.findIndex((topic) => topic.knowledgeId === currentId);
  return position < 0 ? undefined : ordered[position + 1];
}
