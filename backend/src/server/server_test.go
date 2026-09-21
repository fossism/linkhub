package server

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestJwtTokenGenerationAndParsing(t *testing.T) {
	userID := 42
	userEmail := "testuser@linkhub.local"

	tokenStr, err := generateToken(userID, userEmail)
	if err != nil {
		t.Fatalf("generateToken failed: %v", err)
	}

	if tokenStr == "" {
		t.Fatal("generated token string is empty")
	}

	// Parse token back
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return JwtSecret, nil
	})

	if err != nil {
		t.Fatalf("failed to parse generated token: %v", err)
	}

	if !token.Valid {
		t.Fatal("expected token to be valid")
	}

	if claims.ID != userID {
		t.Fatalf("expected userID %d, got %d", userID, claims.ID)
	}

	if claims.Email != userEmail {
		t.Fatalf("expected userEmail %s, got %s", userEmail, claims.Email)
	}
}

func TestPasswordHashingComparison(t *testing.T) {
	clientDerivedAuthHash := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

	// Simulate server-side bcrypting of the auth hash
	serverStoredHash, err := bcrypt.GenerateFromPassword([]byte(clientDerivedAuthHash), 10)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	// Verify correct password matches
	err = bcrypt.CompareHashAndPassword(serverStoredHash, []byte(clientDerivedAuthHash))
	if err != nil {
		t.Fatalf("expected password match, got error: %v", err)
	}

	// Verify wrong password fails
	err = bcrypt.CompareHashAndPassword(serverStoredHash, []byte("wrong_auth_hash"))
	if err == nil {
		t.Fatal("expected password comparison failure for wrong password")
	}
}
