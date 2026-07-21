package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
)

// EncryptBuffer encrypts cleartext using AES-256-GCM.
// The 16-byte authentication tag is appended to the end of the returned ciphertext slice.
func EncryptBuffer(plaintext []byte, keyHex string) ([]byte, string, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode key hex: %w", err)
	}
	if len(key) != 32 {
		return nil, "", fmt.Errorf("invalid key size: key must be 32 bytes (256 bits)")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create cipher block: %w", err)
	}

	// 12-byte IV is standard for GCM
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create GCM block: %w", err)
	}

	iv := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return nil, "", fmt.Errorf("failed to generate random IV: %w", err)
	}

	// Seal appends the 16-byte tag to the ciphertext buffer automatically
	ciphertext := aesgcm.Seal(nil, iv, plaintext, nil)

	return ciphertext, hex.EncodeToString(iv), nil
}

// DecryptBuffer decrypts ciphertext (with appended 16-byte tag) using AES-256-GCM.
func DecryptBuffer(ciphertext []byte, keyHex string, ivHex string) ([]byte, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, fmt.Errorf("failed to decode key hex: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid key size: key must be 32 bytes (256 bits)")
	}

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return nil, fmt.Errorf("failed to decode IV hex: %w", err)
	}
	if len(iv) != 12 {
		return nil, fmt.Errorf("invalid IV size: IV must be 12 bytes")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher block: %w", err)
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM block: %w", err)
	}

	// Open decrypts ciphertext and verifies the appended 16-byte tag
	plaintext, err := aesgcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	return plaintext, nil
}
