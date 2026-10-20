package atproto

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
)

func TestPKCE(t *testing.T) {
	if got := PKCEChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"); got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatal(got)
	}
	v, c, err := NewPKCE()
	if err != nil || len(v) != 64 || c != PKCEChallenge(v) {
		t.Fatalf("invalid PKCE: %v", err)
	}
}
func TestEncryptionFixtures(t *testing.T) {
	// NIST AES-256-GCM vector, Swift-compatible combined nonce/ciphertext/tag.
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	fixture := "aesgcm:AAAAAAAAAAAAAAAAUw+K+8dFNrmpY7TxxMtziw=="
	for _, v := range []string{fixture, strings.Replace(fixture, "aesgcm:", "aesgcm:v1:", 1)} {
		p, err := Decrypt(v, key)
		if err != nil || p != "" {
			t.Fatalf("fixture failed: %q %v", p, err)
		}
	}
	for _, secret := range []string{"", key, base64.StdEncoding.EncodeToString(make([]byte, 48))} {
		sealed, err := Encrypt("token π", secret)
		if err != nil {
			t.Fatal(err)
		}
		p, err := Decrypt(sealed, secret)
		if err != nil || p != "token π" {
			t.Fatal(p, err)
		}
	}
	if p, err := Decrypt("plain:dG9rZW4=", ""); err != nil || p != "token" {
		t.Fatal(p, err)
	}
	for _, v := range []string{"aesgcm:AA==", "plain:!", "unknown:abc", strings.TrimSuffix(fixture, "iw==") + "ig=="} {
		if _, err := Decrypt(v, key); err == nil {
			t.Fatalf("accepted corrupt token %s", v)
		}
	}
	if _, err := Decrypt(fixture, ""); err == nil {
		t.Fatal("accepted missing key")
	}
}
func decodeJWT(t *testing.T, proof string) (map[string]any, map[string]any) {
	t.Helper()
	parts := strings.Split(proof, ".")
	if len(parts) != 3 {
		t.Fatal("invalid JWT")
	}
	var h, p map[string]any
	for i, out := range []*map[string]any{&h, &p} {
		b, err := b64.DecodeString(parts[i])
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(b, out); err != nil {
			t.Fatal(err)
		}
	}
	return h, p
}
func TestSwiftRawDPoPSignature(t *testing.T) {
	raw := make([]byte, 32)
	raw[31] = 1
	stored := `{"rawRepresentation":"` + base64.StdEncoding.EncodeToString(raw) + `"}`
	proof, err := DPoPProof(stored, "post", "https://pds.example/xrpc/test?secret=query#fragment", "access", "nonce")
	if err != nil {
		t.Fatal(err)
	}
	h, p := decodeJWT(t, proof)
	if h["alg"] != "ES256" || h["typ"] != "dpop+jwt" || p["htu"] != "https://pds.example/xrpc/test" || p["htm"] != "POST" || p["nonce"] != "nonce" {
		t.Fatal(h, p)
	}
	jwk := h["jwk"].(map[string]any)
	if jwk["x"] != "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY" {
		t.Fatal("scalar 1 public key mismatch", jwk)
	}
	parts := strings.Split(proof, ".")
	sig, _ := b64.DecodeString(parts[2])
	if len(sig) != 64 {
		t.Fatal("signature must be raw R||S")
	}
	key, _ := parseDPoPKey(stored)
	hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(&key.PublicKey, hash[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("signature did not verify")
	}
	ath := sha256.Sum256([]byte("access"))
	if p["ath"] != b64.EncodeToString(ath[:]) {
		t.Fatal("incorrect token hash")
	}
	for _, k := range []string{`{}`, `{"rawRepresentation":"AA=="}`, `{"rawRepresentation":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}`} {
		if _, err := DPoPProof(k, "GET", "https://a.example", "", ""); err == nil {
			t.Fatal("accepted invalid key")
		}
	}
}
func TestRecordCID(t *testing.T) {
	blob := map[string]any{"$type": "blob", "ref": map[string]any{"$link": "bafkreiahuldz3oqngpfq6nyueb252o6lkhqptwjn7mqumzfykpjqhzvmci"}, "mimeType": "image/png", "size": 48255}
	got, err := RecordCID(blob)
	if err != nil || got != "bafyreiecsgc2guxre4uoa75mobpno6etoheakos7tjag5yq6it5k7qq7cm" {
		t.Fatal(got, err)
	}
	if _, err = RecordCID(map[string]any{"float": 1.5}); err == nil {
		t.Fatal("accepted floating point")
	}
}
