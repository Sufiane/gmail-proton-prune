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

  const normalized = raw.replace(/\s+/g, '').replace(/^<|>$/g, '').toLowerCase();

  return normalized === '' ? null : normalized;
}

export type FolderInfo = {
  path: string;
  specialUse?: string | undefined;
  flags: ReadonlySet<string>;
};

// All Mail is skipped: on Bridge it may also hold trashed mail, which would mask deletions.
export function selectKeptFolders(folders: readonly FolderInfo[]): string[] {
  return folders
    .filter((folder) => !folder.flags.has('\\Noselect') && !folder.flags.has('\\NonExistent'))
    .filter((folder) => folder.specialUse !== '\\Trash' && folder.specialUse !== '\\All')
    .map((folder) => folder.path);
}

export function isConfirmed(answer: string): boolean {
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
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
