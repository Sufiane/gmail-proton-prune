export type ImapAccount = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  allowSelfSignedCert: boolean;
};

export type Config = {
  gmail: ImapAccount;
  proton: ImapAccount;
  maxFlaggedRatio: number;
  minAgeDays: number;
};

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid_env_${name.toLowerCase()}`);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value == null || value.trim() === '') {
    throw new Error(`missing_env_${name.toLowerCase()}`);
  }

  return value.trim();
}

export function readConfig(): Config {
  return {
    gmail: {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: requireEnv('GMAIL_USER'),
      password: requireEnv('GMAIL_APP_PASSWORD').replace(/\s/g, ''),
      allowSelfSignedCert: false,
    },
    // Bridge serves STARTTLS on localhost with its own self-signed cert.
    proton: {
      host: process.env.PROTON_BRIDGE_HOST ?? '127.0.0.1',
      port: readNumberEnv('PROTON_BRIDGE_PORT', 1143),
      secure: false,
      user: requireEnv('PROTON_USER'),
      password: requireEnv('PROTON_BRIDGE_PASSWORD'),
      allowSelfSignedCert: true,
    },
    maxFlaggedRatio: readNumberEnv('MAX_FLAGGED_RATIO', 0.05),
    minAgeDays: readNumberEnv('MIN_AGE_DAYS', 1),
  };
}
