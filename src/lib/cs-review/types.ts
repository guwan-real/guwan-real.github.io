import type { KnowledgeMeta, Question } from './content-schema';
export type { KnowledgeMeta, Question };
export type PracticeMode = 'chapter' | 'knowledge' | 'random' | 'mistakes' | 'favorites' | 'exam';

export interface PublicQuestion {
  id: string;
  revision: number;
  moduleId: Question['moduleId'];
  knowledgeIds: string[];
  type: Question['type'];
  stemHtml: string;
  options: { id: string; html: string }[];
  difficulty: Question['difficulty'];
  source: Question['source'];
  tags: string[];
}
export interface Answer {
  id: string;
  revision: number;
  correctOptionIds: string[];
  analysisHtml: string;
  stepsHtml: string[];
  keyPointHtml: string;
  pitfallHtml: string;
  optionAnalysisHtml?: { id: string; html: string }[];
}
export interface Attempt {
  id: string;
  questionId: string;
  revision: number;
  sessionId: string;
  mode: PracticeMode;
  selectedOptionIds: string[];
  correct: boolean;
  answeredAt: string;
}
export interface QuestionFlag {
  favorite: boolean;
  uncertain: boolean;
  masteredAt: string | null;
  updatedAt: string;
}
export interface Session {
  id: string;
  mode: PracticeMode;
  knowledgeId?: string;
  questionIds: string[];
  revisions: Record<string, number>;
  index: number;
  selections: Record<string, string[]>;
  committed: string[];
  status: 'active' | 'finished';
  createdAt: string;
  submittedAt: string | null;
}
export interface StudyData {
  version: 1;
  attempts: Attempt[];
  flags: Record<string, QuestionFlag>;
  reviewed: Record<string, string>;
  session: Session | null;
}
export interface QuestionStats {
  attempts: number;
  answeredCount: number;
  wrongCount: number;
  latest: Attempt | null;
  needsReview: boolean;
  favorite: boolean;
  uncertain: boolean;
  mastered: boolean;
}
