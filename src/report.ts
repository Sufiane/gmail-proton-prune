import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailSummary } from './diff.ts';

function formatDate(date: Date | null): string {
  if (date == null || Number.isNaN(date.getTime())) {
    return '????-??-??';
  }

  return date.toISOString().slice(0, 10);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function byDateDesc(left: MailSummary, right: MailSummary): number {
  return (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);
}

export function printMails(mails: readonly MailSummary[]): void {
  for (const mail of [...mails].sort(byDateDesc)) {
    console.log(`  ${formatDate(mail.date)}  ${mail.from.slice(0, 40).padEnd(40)}  ${mail.subject}`);
  }
}

export async function writeCsv(mails: readonly MailSummary[]): Promise<string> {
  const directory = 'reports';
  const path = join(directory, `flagged-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  const rows = [...mails]
    .sort(byDateDesc)
    .map((mail) => [formatDate(mail.date), mail.from, mail.subject, mail.messageId ?? ''].map(csvCell).join(','));

  await mkdir(directory, { recursive: true });
  await writeFile(path, ['date,from,subject,message_id', ...rows].join('\n'));

  return path;
}
