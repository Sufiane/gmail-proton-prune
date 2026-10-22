export type MailSummary = {
  uid: number;
  messageId: string | null;
  date: Date | null;
  from: string;
  subject: string;
};

export type PruneResult = {
  flagged: MailSummary[];
  skippedWithoutId: MailSummary[];
};

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }

  const trimmed = raw.trim().replace(/^<|>$/g, '').trim().toLowerCase();

  return trimmed === '' ? null : trimmed;
}

export function findDeletedInProton(
  gmailMails: readonly MailSummary[],
  protonIds: ReadonlySet<string>,
): PruneResult {
  const flagged: MailSummary[] = [];
  const skippedWithoutId: MailSummary[] = [];

  for (const mail of gmailMails) {
    if (mail.messageId == null) {
      skippedWithoutId.push(mail);
      continue;
    }

    if (!protonIds.has(mail.messageId)) {
      flagged.push(mail);
    }
  }

  return { flagged, skippedWithoutId };
}

export function exceedsRatio(flaggedCount: number, scannedCount: number, maxRatio: number): boolean {
  if (scannedCount === 0) {
    return false;
  }

  return flaggedCount / scannedCount > maxRatio;
}
