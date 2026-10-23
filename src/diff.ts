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

const SPECIAL_USE_FLAGS = ['\\Inbox', '\\Sent', '\\Drafts', '\\Archive', '\\Junk', '\\Trash', '\\All', '\\Flagged'];
const KEPT_ROLES = ['\\Inbox', '\\Sent', '\\Drafts', '\\Archive', '\\Junk'];

// Bridge sets \All in LIST flags without advertising SPECIAL-USE, so imapflow leaves specialUse empty.
export function folderRole(folder: FolderInfo): string | null {
  return folder.specialUse ?? SPECIAL_USE_FLAGS.find((flag) => folder.flags.has(flag)) ?? null;
}

// Only Proton's exclusive locations: each mail sits in exactly one. Labels, Starred and All Mail
// are overlays that can still hold trashed mail and would mask deletions.
export function selectKeptFolders(folders: readonly FolderInfo[]): string[] {
  return folders
    .filter((folder) => !folder.flags.has('\\Noselect') && !folder.flags.has('\\NonExistent'))
    .filter((folder) => {
      const role = folderRole(folder);

      return (role != null && KEPT_ROLES.includes(role)) || folder.path.startsWith('Folders/');
    })
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
