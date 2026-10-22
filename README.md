# gmail-proton-prune

Moves Gmail mail to Gmail Trash when it has been deleted in Proton.

Assumes all Gmail mail reaches Proton (history imported via Easy Switch + forwarding on). A Gmail mail whose `Message-ID` is not in Proton's All Mail (or only in Proton's Trash) counts as deleted.

- Scans `[Gmail]/All Mail`, excluding Sent, Drafts and Chats. Spam and Trash are not in All Mail.
- Ignores mail younger than `MIN_AGE_DAYS` because of forwarding delay.
- Mail without a `Message-ID` is listed and left untouched.
- `--apply` only **moves** mail to Gmail Trash (recoverable for 30 days). Nothing is expunged.
- `--apply` aborts if the flagged share exceeds `MAX_FLAGGED_RATIO`.

## Setup

1. Node 24+.
2. Proton Mail Bridge running (paid plan). Copy the IMAP password it shows.
3. Gmail: enable 2FA, then create an app password.
4. Run `cp .env.example .env` and fill it in.
5. Run `npm ci`.

## Usage

```bash
npm run dry-run   # lists flagged mails (date, from, subject) + writes reports/*.csv
npm run apply     # moves them to Gmail Trash
```
