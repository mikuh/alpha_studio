import { activeDomain, type DomainConfig } from './domain';

export function buildCodingPrompt(userPrompt: string, domain: DomainConfig = activeDomain()): string {
  return [
    ...domain.prompt.systemLines,
    '',
    '回答要求：',
    ...domain.prompt.responseGuidance.map((line) => `- ${line}`),
    '',
    '用户任务：',
    userPrompt,
  ].join('\n');
}
