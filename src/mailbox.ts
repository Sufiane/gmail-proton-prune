import { ImapFlow, type FetchMessageObject } from 'imapflow';
import type { ImapAccount } from './config.ts';
import { normalizeMessageId, type FolderInfo, type MailSummary } from './diff.ts';

const MOVE_BATCH_SIZE = 500;

export type ScannedMailbox = {
  mails: MailSummary[];
  uidValidity: bigint;
};

export async function connect(account: ImapAccount): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    doSTARTTLS: account.secure ? undefined : true,
    auth: { user: account.user, pass: account.password },
    tls: { rejectUnauthorized: !account.allowSelfSignedCert },
    logger: false,
  });

  client.on('error', (error: Error) => {
    console.error(`IMAP error (${account.host}): ${error.message}`);
  });

  await client.connect();

  return client;
}

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  return client.list();
}

export async function findMailboxPath(client: ImapFlow, specialUse: string, fallbackPath: string): Promise<string> {
  const mailboxes = await client.list();
  const match =
    mailboxes.find((mailbox) => mailbox.specialUse === specialUse) ??
    mailboxes.find((mailbox) => mailbox.path.toLowerCase() === fallbackPath.toLowerCase());

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

// Fetches 1:* rather than a UID list: a long sparse list can exceed the server's command length.
export async function fetchSummaries(client: ImapFlow, path: string, gmailQuery?: string): Promise<ScannedMailbox> {
  const lock = await client.getMailboxLock(path, { readOnly: true });

  try {
    if (client.mailbox === false) {
      throw new Error('mailbox_not_selected');
    }

    const { exists, uidValidity } = client.mailbox;
    let wantedUids: Set<number> | null = null;

    if (gmailQuery != null) {
      const uids = await client.search({ gmraw: gmailQuery }, { uid: true });

      if (uids === false || uids == null) {
        throw new Error('gmail_search_failed');
      }

      wantedUids = new Set(uids);
    }

    const mails: MailSummary[] = [];
    let fetched = 0;

    if (exists > 0) {
      for await (const message of client.fetch('1:*', { uid: true, envelope: true })) {
        fetched += 1;

        if (wantedUids == null || wantedUids.has(message.uid)) {
          mails.push(toSummary(message));
        }
      }
    }

    if (fetched < exists) {
      console.error(`Fetched ${fetched} of ${exists} messages in "${path}".`);
      throw new Error('fetch_incomplete');
    }

    return { mails, uidValidity };
  } finally {
    lock.release();
  }
}

export async function collectMessageIds(client: ImapFlow, paths: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const path of paths) {
    const { mails } = await fetchSummaries(client, path);

    console.log(`  ${path}: ${mails.length}`);

    for (const mail of mails) {
      if (mail.messageId != null) {
        ids.add(mail.messageId);
      }
    }
  }

  return ids;
}

export async function moveToTrash(
  client: ImapFlow,
  source: { path: string; uidValidity: bigint },
  trashPath: string,
  uids: readonly number[],
): Promise<number> {
  const lock = await client.getMailboxLock(source.path);
  let moved = 0;

  try {
    if (client.mailbox === false || client.mailbox.uidValidity !== source.uidValidity) {
      throw new Error('uid_validity_changed');
    }

    for (let i = 0; i < uids.length; i += MOVE_BATCH_SIZE) {
      const batch = uids.slice(i, i + MOVE_BATCH_SIZE);
      const result = await client.messageMove(batch, trashPath, { uid: true });

      if (result === false || result == null) {
        console.error(`Move failed after ${moved}/${uids.length} mails.`);
        throw new Error('move_batch_failed');
      }

      const batchMoved = result.uidMap?.size ?? batch.length;

      if (batchMoved < batch.length) {
        console.warn(`  ${batch.length - batchMoved} mails in this batch were already gone.`);
      }

      moved += batchMoved;
      console.log(`  moved ${moved}/${uids.length}`);
    }
  } finally {
    lock.release();
  }

  return moved;
}
