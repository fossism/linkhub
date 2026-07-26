package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func TestEncryptDecryptBufferRoundtrip(t *testing.T) {
	// Generate random 256-bit (32 byte) key
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		t.Fatalf("failed to generate random key: %v", err)
	}
	keyHex := hex.EncodeToString(keyBytes)

	originalData := []byte("Hello, LinkHub zero-knowledge encryption test!")

	ciphertext, ivHex, err := EncryptBuffer(originalData, keyHex)
	if err != nil {
		t.Fatalf("EncryptBuffer failed: %v", err)
	}

	if len(ciphertext) == 0 {
		t.Fatal("expected non-empty ciphertext")
	}

	if len(ivHex) != 24 { // 12 bytes = 24 hex characters
		t.Fatalf("expected 24 char IV hex, got %d", len(ivHex))
	}

	decrypted, err := DecryptBuffer(ciphertext, keyHex, ivHex)
	if err != nil {
		t.Fatalf("DecryptBuffer failed: %v", err)
	}

	if !bytes.Equal(originalData, decrypted) {
		t.Fatalf("decrypted payload mismatch. Expected %s, got %s", originalData, decrypted)
	}
}

func TestInvalidKeySize(t *testing.T) {
	shortKeyHex := "1234567890abcdef" // 8 bytes instead of 32
	plaintext := []byte("test")

	_, _, err := EncryptBuffer(plaintext, shortKeyHex)
	if err == nil {
		t.Fatal("expected error for invalid key size, got nil")
	}

	_, err = DecryptBuffer([]byte("dummy"), shortKeyHex, "123456789012345678901234")
	if err == nil {
		t.Fatal("expected error for invalid key size on decrypt, got nil")
	}
}

func TestAlteredCiphertextFailsTagVerification(t *testing.T) {
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)
	keyHex := hex.EncodeToString(keyBytes)

	ciphertext, ivHex, err := EncryptBuffer([]byte("Sensitive data"), keyHex)
	if err != nil {
		t.Fatalf("EncryptBuffer failed: %v", err)
	}

	// Tamper with ciphertext byte
	ciphertext[0] ^= 0xFF

	_, err = DecryptBuffer(ciphertext, keyHex, ivHex)
	if err == nil {
		t.Fatal("expected decryption failure due to tampered authentication tag, but decryption succeeded")
	}
}
