import { ImapFlow, type FetchMessageObject } from 'imapflow';
import type { ImapAccount } from './config.ts';
import { normalizeMessageId, type MailSummary } from './diff.ts';

const MOVE_BATCH_SIZE = 500;

export async function connect(account: ImapAccount): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: account.password },
    tls: { rejectUnauthorized: !account.allowSelfSignedCert },
    logger: false,
  });

  await client.connect();

  return client;
}

export async function findMailboxPath(client: ImapFlow, specialUse: string, fallbackName: string): Promise<string> {
  const mailboxes = await client.list();
  const match =
    mailboxes.find((mailbox) => mailbox.specialUse === specialUse) ??
    mailboxes.find((mailbox) => mailbox.name.toLowerCase() === fallbackName.toLowerCase());

  if (match == null) {
    throw new Error(`mailbox_not_found_${specialUse.replace('\\', '').toLowerCase()}`);
  }

  return match.path;
}

function toSummary(message: FetchMessageObject): MailSummary {
  const envelope = message.envelope;
  const sender = envelope?.from?.[0];
  const rawDate = envelope?.date;

  return {
    uid: message.uid,
    messageId: normalizeMessageId(envelope?.messageId),
    date: rawDate == null ? null : new Date(rawDate),
    from: sender == null ? '' : (sender.name ?? '') + (sender.address == null ? '' : ` <${sender.address}>`),
    subject: envelope?.subject ?? '',
  };
}

export async function fetchSummaries(client: ImapFlow, path: string, gmailQuery?: string): Promise<MailSummary[]> {
  const lock = await client.getMailboxLock(path, { readOnly: true });

  try {
    let range: number[] | string = '1:*';

    if (gmailQuery != null) {
      const uids = await client.search({ gmraw: gmailQuery }, { uid: true });

      if (uids === false || uids == null || uids.length === 0) {
        return [];
      }

      range = uids;
    }

    const summaries: MailSummary[] = [];

    for await (const message of client.fetch(range, { uid: true, envelope: true }, { uid: true })) {
      summaries.push(toSummary(message));
    }

    return summaries;
  } finally {
    lock.release();
  }
}

export async function collectMessageIds(client: ImapFlow, path: string): Promise<Set<string>> {
  const summaries = await fetchSummaries(client, path);
  const ids = new Set<string>();

  for (const summary of summaries) {
    if (summary.messageId != null) {
      ids.add(summary.messageId);
    }
  }

  return ids;
}

export async function moveToTrash(
  client: ImapFlow,
  sourcePath: string,
  trashPath: string,
  uids: readonly number[],
): Promise<number> {
  const lock = await client.getMailboxLock(sourcePath);
  let moved = 0;

  try {
    for (let i = 0; i < uids.length; i += MOVE_BATCH_SIZE) {
      const batch = uids.slice(i, i + MOVE_BATCH_SIZE);
      const result = await client.messageMove(batch, trashPath, { uid: true });

      if (result !== false) {
        moved += batch.length;
      }

      console.log(`  moved ${moved}/${uids.length}`);
    }
  } finally {
    lock.release();
  }

  return moved;
}
