import { Client } from '@xmtp/node-sdk';
import { createEOASigner } from './signer.js';
import { getRandomValues } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';

const DB_ENCRYPTION_KEY_FILE = '.xmtp-encryption-key';

async function getOrCreateEncryptionKey() {
  try {
    // Try to read existing key
    const keyHex = await fs.readFile(DB_ENCRYPTION_KEY_FILE, 'utf8');
    return new Uint8Array(Buffer.from(keyHex.trim(), 'hex'));
  } catch (error) {
    // Generate new key if doesn't exist
    const key = getRandomValues(new Uint8Array(32));
    const keyHex = Buffer.from(key).toString('hex');
    await fs.writeFile(DB_ENCRYPTION_KEY_FILE, keyHex);
    console.log('Generated new DB encryption key');
    return key;
  }
}

export async function setupXMTPClient(privateKey, options = {}) {
  const signer = createEOASigner(privateKey);
  const dbEncryptionKey = await getOrCreateEncryptionKey();
  
  // Check if we should build existing client
  const dbPath = options.dbPath || './xmtp-db';
  const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
  
  let client;
  try {
    if (dbExists) {
      console.log('Building existing XMTP client...');
      const identity = signer.getIdentity();
      client = await Client.build(identity, {
        env: process.env.XMTP_ENV || 'production',
        dbEncryptionKey,
        dbPath,
        ...options
      });
    } else {
      console.log('Creating new XMTP client...');
      console.log('Registering identity on XMTP network...');
      client = await Client.create(signer, {
        env: process.env.XMTP_ENV || 'production',
        dbEncryptionKey,
        dbPath,
        ...options
      });
      console.log('Identity registered successfully!');
    }
    
    // Get client information for v3
    const inboxState = await client.preferences.inboxState();
    const address = inboxState.identifiers[0]?.identifier || 'Unknown';
    const inboxId = client.inboxId;
    const installationId = client.installationId;
    
    console.log('\n=== XMTP Client Info ===');
    console.log(`Inbox ID: ${inboxId}`);
    console.log(`Address: ${address}`);
    console.log(`Installation ID: ${installationId}`);
    console.log(`Active Installations: ${inboxState.installations.length}/10`);
    console.log(`Linked Wallets: ${inboxState.identifiers.length}`);
    console.log('========================\n');
    
    // Warn if approaching installation limit
    if (inboxState.installations.length >= 8) {
      console.warn('⚠️  Warning: Approaching installation limit (10 max). Consider revoking old installations.');
    }
    
    return client;
  } catch (error) {
    console.error('Failed to setup XMTP client:', error);
    throw error;
  }
}