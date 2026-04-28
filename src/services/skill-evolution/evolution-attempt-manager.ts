import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import type { CompactCase } from './case-extractor';
import type { BalanceAnalysisResult } from './balance-analyzer';
import type { BacktestResult, BacktestDetailRow } from './backtest-validator';

export interface CreateAttemptData {
  taskId: string;
  attemptNumber: number;
  falsePositiveCasesUsed: CompactCase[];
  confirmedCasesUsed: CompactCase[];
  falsePositivePatterns: string[];
  confirmedPatterns: string[];
  recommendations: BalanceAnalysisResult['recommendations'];
  improvedContent: string;
  changeSummary: string[];
  backtestResult: BacktestResult;
  backtestDetailRows: BacktestDetailRow[];
  isPassed: boolean;
  failureReason?: string;
  missedCasesInfo?: CompactCase[];
  remainingFalsePositive?: CompactCase[];
}

export interface AttemptDetail {
  id: string;
  taskId: string;
  attemptNumber: number;
  falsePositiveCasesUsed: CompactCase[];
  confirmedCasesUsed: CompactCase[];
  falsePositivePatterns: string[];
  confirmedPatterns: string[];
  recommendations: BalanceAnalysisResult['recommendations'];
  improvedContent: string;
  changeSummary: string[];
  backtestSummary: BacktestResult['summary'];
  backtestDetailRows: BacktestDetailRow[];
  falsePositiveExclusionRate: number;
  confirmedMissed: number;
  failureReason: string | null;
  missedCasesInfo: CompactCase[];
  remainingFalsePositive: CompactCase[];
  isPassed: boolean;
  status: string;
  createdAt: Date;
}

export async function createEvolutionAttempt(data: CreateAttemptData): Promise<string> {
  const attempt = await prisma.evolutionAttempt.create({
    data: {
      id: generateId('evoatt'),
      taskId: data.taskId,
      attemptNumber: data.attemptNumber,
      falsePositiveCasesUsed: JSON.stringify(data.falsePositiveCasesUsed),
      confirmedCasesUsed: JSON.stringify(data.confirmedCasesUsed),
      falsePositivePatterns: JSON.stringify(data.falsePositivePatterns),
      confirmedPatterns: JSON.stringify(data.confirmedPatterns),
      recommendations: JSON.stringify(data.recommendations),
      improvedContent: data.improvedContent,
      changeSummary: JSON.stringify(data.changeSummary),
      backtestSummary: JSON.stringify(data.backtestResult.summary),
      falsePositiveExclusionRate: data.backtestResult.summary.falsePositiveExclusionRate,
      confirmedMissed: data.backtestResult.summary.confirmedMissed,
      backtestDetailRows: JSON.stringify(data.backtestDetailRows),
      failureReason: data.failureReason || null,
      missedCasesInfo: data.missedCasesInfo ? JSON.stringify(data.missedCasesInfo) : null,
      remainingFalsePositive: data.remainingFalsePositive ? JSON.stringify(data.remainingFalsePositive) : null,
      isPassed: data.isPassed,
      status: data.isPassed ? 'passed' : 'failed',
    },
  });

  return attempt.id;
}

export async function getAttemptsByTaskId(taskId: string): Promise<AttemptDetail[]> {
  const attempts = await prisma.evolutionAttempt.findMany({
    where: { taskId },
    orderBy: { attemptNumber: 'asc' },
  });

  return attempts.map(parseAttempt);
}

export async function getAttemptById(attemptId: string): Promise<AttemptDetail | null> {
  const attempt = await prisma.evolutionAttempt.findUnique({
    where: { id: attemptId },
  });

  if (!attempt) return null;

  return parseAttempt(attempt);
}

export async function getPassedAttemptByTaskId(taskId: string): Promise<AttemptDetail | null> {
  const attempt = await prisma.evolutionAttempt.findFirst({
    where: { taskId, isPassed: true },
    orderBy: { attemptNumber: 'asc' },
  });

  if (!attempt) return null;

  return parseAttempt(attempt);
}

function parseAttempt(attempt: any): AttemptDetail {
  return {
    id: attempt.id,
    taskId: attempt.taskId,
    attemptNumber: attempt.attemptNumber,
    falsePositiveCasesUsed: safeParseJSON(attempt.falsePositiveCasesUsed) || [],
    confirmedCasesUsed: safeParseJSON(attempt.confirmedCasesUsed) || [],
    falsePositivePatterns: safeParseJSON(attempt.falsePositivePatterns) || [],
    confirmedPatterns: safeParseJSON(attempt.confirmedPatterns) || [],
    recommendations: safeParseJSON(attempt.recommendations) || [],
    improvedContent: attempt.improvedContent || '',
    changeSummary: safeParseJSON(attempt.changeSummary) || [],
    backtestSummary: safeParseJSON(attempt.backtestSummary) || {},
    backtestDetailRows: safeParseJSON(attempt.backtestDetailRows) || [],
    falsePositiveExclusionRate: attempt.falsePositiveExclusionRate || 0,
    confirmedMissed: attempt.confirmedMissed || 0,
    failureReason: attempt.failureReason || null,
    missedCasesInfo: safeParseJSON(attempt.missedCasesInfo) || [],
    remainingFalsePositive: safeParseJSON(attempt.remainingFalsePositive) || [],
    isPassed: attempt.isPassed || false,
    status: attempt.status || 'pending',
    createdAt: attempt.createdAt,
  };
}

function safeParseJSON(jsonStr: string | null): any {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export default {
  createEvolutionAttempt,
  getAttemptsByTaskId,
  getAttemptById,
  getPassedAttemptByTaskId,
};