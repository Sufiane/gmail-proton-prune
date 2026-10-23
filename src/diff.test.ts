import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  exceedsRatio,
  findDeletedInProton,
  folderRole,
  isConfirmed,
  normalizeMessageId,
  selectKeptFolders,
  type FolderInfo,
  type MailSummary,
} from './diff.ts';

function mail(uid: number, messageId: string | null): MailSummary {
  return { uid, messageId, date: null, from: 'a@b.c', subject: `mail ${uid}` };
}

describe('normalizeMessageId', () => {
  describe('when the id has angle brackets, spaces and mixed case', () => {
    it('strips and lowercases it', () => {
      assert.equal(normalizeMessageId('  <ABC@Mail.Gmail.com> '), 'abc@mail.gmail.com');
    });
  });

  describe('when the id contains folded whitespace', () => {
    it('removes it', () => {
      assert.equal(normalizeMessageId('<abc\r\n def@x.com>'), 'abcdef@x.com');
    });
  });

  describe('when the id is missing', () => {
    it('returns null', () => {
      assert.equal(normalizeMessageId(undefined), null);
    });
  });

  describe('when the id is empty brackets', () => {
    it('returns null', () => {
      assert.equal(normalizeMessageId('<>'), null);
    });
  });
});

function folder(path: string, specialUse?: string, flags: string[] = []): FolderInfo {
  return { path, specialUse, flags: new Set(flags) };
}

describe('folderRole', () => {
  describe('when specialUse is set', () => {
    it('returns it', () => {
      assert.equal(folderRole(folder('INBOX', '\\Inbox')), '\\Inbox');
    });
  });

  describe('when only the LIST flags carry the role', () => {
    it('reads it from the flags', () => {
      assert.equal(folderRole(folder('All Mail', undefined, ['\\All', '\\Marked'])), '\\All');
    });
  });

  describe('when the folder has no role', () => {
    it('returns null', () => {
      assert.equal(folderRole(folder('Labels/Work', undefined, ['\\Marked'])), null);
    });
  });
});

describe('selectKeptFolders', () => {
  describe('when Bridge lists its folders', () => {
    const folders = [
      folder('INBOX', '\\Inbox'),
      folder('Sent', '\\Sent', ['\\Sent']),
      folder('Drafts', '\\Drafts', ['\\Drafts']),
      folder('Archive', '\\Archive', ['\\Archive']),
      folder('Spam', '\\Junk', ['\\Junk']),
      folder('Trash', '\\Trash', ['\\Trash']),
      folder('All Mail', undefined, ['\\All']),
      folder('Starred', undefined, ['\\Flagged']),
      folder('Folders', undefined, ['\\Noselect']),
      folder('Folders/Bills'),
      folder('Labels', undefined, ['\\Noselect']),
      folder('Labels/Work'),
    ];

    it('keeps only the exclusive locations', () => {
      assert.deepEqual(selectKeptFolders(folders), ['INBOX', 'Sent', 'Drafts', 'Archive', 'Spam', 'Folders/Bills']);
    });
  });
});

describe('isConfirmed', () => {
  describe('when the answer is y or yes in any case', () => {
    it('returns true', () => {
      assert.equal(isConfirmed(' Y '), true);
      assert.equal(isConfirmed('yes'), true);
    });
  });

  describe('when the answer is anything else', () => {
    it('returns false', () => {
      assert.equal(isConfirmed(''), false);
      assert.equal(isConfirmed('n'), false);
      assert.equal(isConfirmed('yep'), false);
    });
  });
});

describe('findDeletedInProton', () => {
  describe('when a Gmail mail is absent from Proton', () => {
    it('flags it', () => {
      const result = findDeletedInProton([mail(1, 'kept'), mail(2, 'gone')], new Set(['kept']));

      assert.deepEqual(result.flagged.map((entry) => entry.uid), [2]);
    });
  });

  describe('when a Gmail mail has no Message-ID', () => {
    it('skips it instead of flagging', () => {
      const result = findDeletedInProton([mail(1, null)], new Set());

      assert.equal(result.flagged.length, 0);
      assert.deepEqual(result.skippedWithoutId.map((entry) => entry.uid), [1]);
    });
  });
});

describe('exceedsRatio', () => {
  describe('when flagged share is above the max', () => {
    it('returns true', () => {
      assert.equal(exceedsRatio(31, 100, 0.3), true);
    });
  });

  describe('when flagged share is at or below the max', () => {
    it('returns false', () => {
      assert.equal(exceedsRatio(30, 100, 0.3), false);
    });
  });

  describe('when nothing was scanned', () => {
    it('returns false', () => {
      assert.equal(exceedsRatio(0, 0, 0.3), false);
    });
  });
});
