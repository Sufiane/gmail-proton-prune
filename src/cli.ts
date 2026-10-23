import { createInterface } from 'node:readline/promises';
import type { ImapFlow } from 'imapflow';
import { readConfig } from './config.ts';
import { exceedsRatio, findDeletedInProton, isConfirmed, selectKeptFolders } from './diff.ts';
import {
  collectMessageIds,
  connect,
  countMessages,
  fetchSummaries,
  findMailboxPath,
  listFolders,
  moveToTrash,
} from './mailbox.ts';
import { printMails, writeCsv } from './report.ts';

function buildGmailQuery(minAgeDays: number): string {
  const filters = ['-in:sent', '-in:draft', '-in:chats'];

  if (minAgeDays > 0) {
    filters.push(`older_than:${Math.ceil(minAgeDays)}d`);
  }

  return filters.join(' ');
}

async function loadProtonIds(proton: ImapFlow): Promise<Set<string>> {
  const keptFolders = selectKeptFolders(await listFolders(proton));

  console.log(`Proton: reading ${keptFolders.length} folders (${keptFolders.join(', ')})…`);
  const { ids, messageCount } = await collectMessageIds(proton, keptFolders);
  const [trashCount, allMailCount] = await Promise.all([
    findMailboxPath(proton, '\\Trash', 'Trash').then((path) => countMessages(proton, path)),
    findMailboxPath(proton, '\\All', 'All Mail').then((path) => countMessages(proton, path)),
  ]);

  console.log(`Proton: ${messageCount} kept + ${trashCount} in Trash, All Mail holds ${allMailCount}`);

  if (messageCount + trashCount !== allMailCount) {
    throw new Error('proton_folder_mismatch');
  }

  console.log(`Proton: ${ids.size} distinct kept Message-IDs`);

  return ids;
}

async function askConfirmation(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('confirmation_requires_tty');
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return isConfirmed(await prompt.question(question));
  } finally {
    prompt.close();
  }
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const config = readConfig();
  const proton = await connect(config.proton);
  const gmail = await connect(config.gmail).catch(async (error: unknown) => {
    await proton.logout();
    throw error;
  });

  try {
    const protonIds = await loadProtonIds(proton);

    if (protonIds.size === 0) {
      throw new Error('proton_mailbox_empty');
    }

    const gmailAllMail = await findMailboxPath(gmail, '\\All', '[Gmail]/All Mail');
    const gmailTrash = await findMailboxPath(gmail, '\\Trash', '[Gmail]/Trash');
    const query = buildGmailQuery(config.minAgeDays);

    console.log(`Gmail: reading "${gmailAllMail}" (${query})…`);
    const scanned = await fetchSummaries(gmail, gmailAllMail, query);
    const { flagged, skippedWithoutId } = findDeletedInProton(scanned.mails, protonIds);

    console.log(`\nFlagged (in Gmail, deleted in Proton): ${flagged.length}`);
    printMails(flagged);

    if (skippedWithoutId.length > 0) {
      console.log(`\nSkipped, no Message-ID (left untouched): ${skippedWithoutId.length}`);
      printMails(skippedWithoutId);
    }

    console.log(`\nScanned ${scanned.mails.length} Gmail mails, flagged ${flagged.length}.`);

    if (flagged.length > 0) {
      console.log(`Full list: ${await writeCsv(flagged)}`);
    }

    const tooMany = exceedsRatio(flagged.length, scanned.mails.length, config.maxFlaggedRatio);

    if (tooMany) {
      console.warn(`\nWARNING: flagged share exceeds MAX_FLAGGED_RATIO=${config.maxFlaggedRatio}. Matching may be broken.`);
    }

    if (!apply) {
      console.log('\nDry run, nothing changed. Re-run with --apply to move flagged mails to Gmail Trash.');

      return;
    }

    if (tooMany) {
      throw new Error('flagged_ratio_exceeded');
    }

    if (flagged.length === 0) {
      return;
    }

    const confirmed = await askConfirmation(`\nMove ${flagged.length} mails to "${gmailTrash}"? [y/N] `);

    if (!confirmed) {
      console.log('Aborted, nothing changed.');

      return;
    }

    const moved = await moveToTrash(
      gmail,
      { path: gmailAllMail, uidValidity: scanned.uidValidity },
      gmailTrash,
      flagged.map((mail) => mail.uid),
    );

    console.log(`Done: ${moved} moved to Gmail Trash (recoverable for 30 days).`);
  } finally {
    await Promise.allSettled([proton.logout(), gmail.logout()]);
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
