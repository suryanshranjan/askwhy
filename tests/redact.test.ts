import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

test('masks common key shapes', () => {
  assert.equal(redact('use rzp_live_ABCDEFGH12345678 here'), 'use [REDACTED_KEY] here');
  assert.equal(redact('token ghp_abcdefghijklmnopqrstuvwxyz1234'), 'token [REDACTED_GITHUB_TOKEN]');
  assert.equal(redact('AKIAIOSFODNN7EXAMPLE'), '[REDACTED_AWS_KEY]');
  assert.equal(redact('sk-abcdefghijklmnopqrstuvwxyz'), '[REDACTED_API_KEY]');
});

test('masks connection-string passwords but keeps the scheme', () => {
  assert.equal(
    redact('DATABASE_URL=postgresql://user:hunter2@host:5432/db'),
    'DATABASE_URL=postgresql://[REDACTED]@host:5432/db',
  );
  assert.equal(redact('see postgres://u:p4ssw0rd@neon.tech/x'), 'see postgres://[REDACTED]@neon.tech/x');
});

test('masks KEY=value assignments and leaves prose alone', () => {
  assert.equal(redact('BANK_DATA_ENCRYPTION_KEY=0123456789abcdef'), 'BANK_DATA_ENCRYPTION_KEY=[REDACTED]');
  assert.equal(redact('make the payout worker survive Razorpay timeouts'), 'make the payout worker survive Razorpay timeouts');
});

test('supports extra patterns', () => {
  assert.equal(redact('call +919876543210', [/\+91\d{10}/g]), 'call [REDACTED]');
});
