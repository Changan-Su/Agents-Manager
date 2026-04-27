import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto'

// AES-256-GCM with scrypt-derived key.
//
// Container layout (single Buffer):
//   magic       4 bytes  "AMV1"
//   version     1 byte   0x01
//   saltLen     1 byte   (always 16)
//   salt        16 bytes
//   ivLen       1 byte   (always 12)
//   iv          12 bytes
//   tagLen      1 byte   (always 16)
//   tag         16 bytes
//   ciphertext  remainder
//
// All version-byte changes require a new versioned reader.

const MAGIC = Buffer.from('AMV1', 'ascii')
const VERSION = 0x01
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
// scrypt parameters chosen for ~250ms on a modern laptop.
// N=2^15, r=8, p=1, dkLen=32 → 32-byte key for AES-256
const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

export interface EncryptionMetadata {
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  scrypt: { N: number; r: number; p: number }
  saltB64: string
}

export interface EncryptResult {
  ciphertext: Buffer
  metadata: EncryptionMetadata
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  })
}

export function encrypt(plaintext: Buffer, passphrase: string): EncryptResult {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('passphrase must be at least 8 characters')
  }
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  const out = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, SALT_LEN]),
    salt,
    Buffer.from([IV_LEN]),
    iv,
    Buffer.from([TAG_LEN]),
    tag,
    enc,
  ])
  return {
    ciphertext: out,
    metadata: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      scrypt: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      saltB64: salt.toString('base64'),
    },
  }
}

export function decrypt(ciphertext: Buffer, passphrase: string): Buffer {
  if (ciphertext.length < MAGIC.length + 1 + 1 + SALT_LEN + 1 + IV_LEN + 1 + TAG_LEN) {
    throw new Error('ciphertext too short')
  }
  let p = 0
  const magic = ciphertext.subarray(p, p + MAGIC.length)
  p += MAGIC.length
  if (!timingSafeEqual(magic, MAGIC)) throw new Error('bad magic — not an AMV1 blob')
  const version = ciphertext[p++]
  if (version !== VERSION) throw new Error(`unsupported version ${version}`)
  const saltLen = ciphertext[p++]
  if (saltLen !== SALT_LEN) throw new Error(`unexpected salt length ${saltLen}`)
  const salt = ciphertext.subarray(p, p + saltLen)
  p += saltLen
  const ivLen = ciphertext[p++]
  if (ivLen !== IV_LEN) throw new Error(`unexpected iv length ${ivLen}`)
  const iv = ciphertext.subarray(p, p + ivLen)
  p += ivLen
  const tagLen = ciphertext[p++]
  if (tagLen !== TAG_LEN) throw new Error(`unexpected tag length ${tagLen}`)
  const tag = ciphertext.subarray(p, p + tagLen)
  p += tagLen
  const enc = ciphertext.subarray(p)

  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()])
  } catch {
    throw new Error('decryption failed — wrong passphrase or tampered blob')
  }
}
