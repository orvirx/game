#!/usr/bin/env node
// optional publisher. reads a saved draft from posts/, checks it against the
// voice rules, and only then offers to send it.
//
// defaults to a dry run. it will not post without --yes, and it will not post
// at all if the linter finds an error. media is deliberately not supported:
// screen recordings get checked by eye for personal data before they go up.
//
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//   node tools/x-post.js posts/2026-09-12-balance.md            # dry run
//   node tools/x-post.js posts/2026-09-12-balance.md --yes      # posts it

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lint, format } from './voice.js';

const ENDPOINT = 'https://api.x.com/2/tweets';

export function parseDraft(markdown) {
  const parts = [];
  const re = /^##\s+(opener|reply \d+)\s*$/gm;
  const marks = [...markdown.matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : markdown.length;
    const body = markdown.slice(start, end).split(/^##\s+receipts\s*$/m)[0].trim();
    if (body) parts.push(body);
  });
  return parts;
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthHeader(method, url, creds) {
  const params = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const base = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(
      Object.keys(params).sort().map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&')
    ),
  ].join('&');
  const key = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessSecret)}`;
  params.oauth_signature = createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(params).sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(params[k])}"`).join(', ');
}

async function postOne(text, replyTo, creds) {
  const payload = { text };
  if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', ENDPOINT, creds),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`x api ${res.status}: ${JSON.stringify(body)}`);
  return body.data.id;
}

function creds() {
  const c = {
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  };
  const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing credentials: ${missing.join(', ')}`);
  return c;
}

async function main() {
  const file = process.argv.find((a) => a.endsWith('.md'));
  const inline = process.argv.find((a) => a.startsWith('--text='));
  if (!file && !inline) {
    console.error('usage: node tools/x-post.js posts/<draft>.md [--yes]');
    process.exit(1);
  }
  const parts = inline ? [inline.slice('--text='.length)] : parseDraft(readFileSync(file, 'utf8'));
  if (!parts.length) { console.error('nothing to post — no opener section found'); process.exit(1); }

  let blocked = false;
  parts.forEach((text, i) => {
    const res = lint(text, { kind: i === 0 ? 'opener' : 'reply' });
    console.log(`\n--- ${i === 0 ? 'opener' : `reply ${i}`} · ${text.length} chars ---\n${text}`);
    if (res.issues.length) console.log(`\n${format(res.issues)}`);
    if (!res.ok) blocked = true;
  });
  if (blocked) { console.error('\nnot posting: the draft breaks the voice rules'); process.exit(2); }

  if (!process.argv.includes('--yes')) {
    console.log('\ndry run. re-run with --yes to publish');
    console.log('reminder: first 15-30 minutes in the replies is the only real lever on reach');
    return;
  }

  const c = creds();
  let previous = null;
  for (let i = 0; i < parts.length; i++) {
    previous = await postOne(parts[i], previous, c);
    console.log(`posted ${i === 0 ? 'opener' : `reply ${i}`}: https://x.com/0x_orvir/status/${previous}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('x-post.js')) {
  main().catch((e) => { console.error(`failed: ${e.message}`); process.exit(1); });
}
