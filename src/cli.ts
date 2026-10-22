import type { ImapFlow } from 'imapflow';
import { readConfig } from './config.ts';
import { exceedsRatio, findDeletedInProton } from './diff.ts';
import { collectMessageIds, connect, fetchSummaries, findMailboxPath, moveToTrash } from './mailbox.ts';
import { printMails, writeCsv } from './report.ts';

function buildGmailQuery(minAgeDays: number): string {
  const filters = ['-in:sent', '-in:draft', '-in:chats'];

  if (minAgeDays > 0) {
    filters.push(`older_than:${Math.ceil(minAgeDays)}d`);
  }

  return filters.join(' ');
}

async function loadProtonIds(proton: ImapFlow): Promise<Set<string>> {
  const allMailPath = await findMailboxPath(proton, '\\All', 'All Mail');
  const trashPath = await findMailboxPath(proton, '\\Trash', 'Trash');

  console.log(`Proton: reading "${allMailPath}"…`);
  const ids = await collectMessageIds(proton, allMailPath);

  console.log(`Proton: reading "${trashPath}"…`);
  const trashedIds = await collectMessageIds(proton, trashPath);

  for (const id of trashedIds) {
    ids.delete(id);
  }

  console.log(`Proton: ${ids.size} kept mails (${trashedIds.size} in trash, treated as deleted)`);

  return ids;
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
    const gmailMails = await fetchSummaries(gmail, gmailAllMail, query);
    const { flagged, skippedWithoutId } = findDeletedInProton(gmailMails, protonIds);

    console.log(`\nFlagged (in Gmail, deleted in Proton): ${flagged.length}`);
    printMails(flagged);

    if (skippedWithoutId.length > 0) {
      console.log(`\nSkipped, no Message-ID (left untouched): ${skippedWithoutId.length}`);
      printMails(skippedWithoutId);
    }

    console.log(`\nScanned ${gmailMails.length} Gmail mails, flagged ${flagged.length}.`);

    if (flagged.length > 0) {
      console.log(`Full list: ${await writeCsv(flagged)}`);
    }

    const tooMany = exceedsRatio(flagged.length, gmailMails.length, config.maxFlaggedRatio);

    if (tooMany) {
      console.warn(`\n⚠ Flagged share exceeds MAX_FLAGGED_RATIO=${config.maxFlaggedRatio}. Matching may be broken.`);
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

    console.log(`\nMoving ${flagged.length} mails to "${gmailTrash}"…`);
    const moved = await moveToTrash(gmail, gmailAllMail, gmailTrash, flagged.map((mail) => mail.uid));

    console.log(`Done: ${moved} moved to Gmail Trash (recoverable for 30 days).`);
  } finally {
    await Promise.allSettled([proton.logout(), gmail.logout()]);
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
