// Package atproto implements AnyPub's OAuth and PDS transport without persistence.
package atproto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/url"
	"strings"
	"time"
)

var b64 = base64.RawURLEncoding

func randomString(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return b64.EncodeToString(b), err
}
func NewPKCE() (verifier, challenge string, err error) {
	verifier, err = randomString(48)
	return verifier, PKCEChallenge(verifier), err
}
func PKCEChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return b64.EncodeToString(sum[:])
}

func encryptionKey(secret string) []byte {
	b, err := base64.StdEncoding.DecodeString(secret)
	if err != nil || len(b) < 32 {
		return nil
	}
	return b[:32]
}

// Encrypt preserves Swift's plain: fallback and aesgcm: combined representation.
func Encrypt(plaintext, secret string) (string, error) {
	key := encryptionKey(secret)
	if key == nil {
		return "plain:" + base64.StdEncoding.EncodeToString([]byte(plaintext)), nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return "aesgcm:" + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}
func Decrypt(ciphertext, secret string) (string, error) {
	if strings.HasPrefix(ciphertext, "plain:") {
		b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, "plain:"))
		return string(b), err
	}
	if !strings.HasPrefix(ciphertext, "aesgcm:") {
		return "", errors.New("invalid token ciphertext")
	}
	encoded := strings.TrimPrefix(ciphertext, "aesgcm:")
	encoded = strings.TrimPrefix(encoded, "v1:")
	key := encryptionKey(secret)
	if key == nil {
		return "", errors.New("token encryption key unavailable")
	}
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(b) < gcm.NonceSize()+gcm.Overhead() {
		return "", errors.New("invalid token ciphertext")
	}
	p, err := gcm.Open(nil, b[:gcm.NonceSize()], b[gcm.NonceSize():], nil)
	return string(p), err
}

// NewDPoPKey returns Swift-compatible JSON containing a base64 P-256 scalar.
func NewDPoPKey() (string, error) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(map[string]string{"rawRepresentation": base64.StdEncoding.EncodeToString(k.Bytes())})
	return string(b), err
}
func parseDPoPKey(value string) (*ecdsa.PrivateKey, error) {
	var stored struct {
		Raw string `json:"rawRepresentation"`
	}
	if err := json.Unmarshal([]byte(value), &stored); err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(stored.Raw)
	if err != nil {
		return nil, err
	}
	scalar := new(big.Int).SetBytes(raw)
	curve := elliptic.P256()
	if len(raw) != 32 || scalar.Sign() <= 0 || scalar.Cmp(curve.Params().N) >= 0 {
		return nil, errors.New("invalid DPoP private key")
	}
	x, y := curve.ScalarBaseMult(raw)
	return &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: curve, X: x, Y: y}, D: scalar}, nil
}

// DPoPProof omits query and fragment from htu, as required by RFC 9449.
func DPoPProof(privateKey, method, target, accessToken, nonce string) (string, error) {
	key, err := parseDPoPKey(privateKey)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(target)
	if err != nil || u.Host == "" {
		return "", errors.New("invalid DPoP target")
	}
	u.RawQuery = ""
	u.Fragment = ""
	jti, err := randomString(16)
	if err != nil {
		return "", err
	}
	header := map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": map[string]string{"kty": "EC", "crv": "P-256", "x": b64.EncodeToString(key.X.FillBytes(make([]byte, 32))), "y": b64.EncodeToString(key.Y.FillBytes(make([]byte, 32)))}}
	payload := map[string]any{"jti": jti, "htm": strings.ToUpper(method), "htu": u.String(), "iat": time.Now().Unix()}
	if nonce != "" {
		payload["nonce"] = nonce
	}
	if accessToken != "" {
		hash := sha256.Sum256([]byte(accessToken))
		payload["ath"] = b64.EncodeToString(hash[:])
	}
	h, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	p, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	input := b64.EncodeToString(h) + "." + b64.EncodeToString(p)
	hash := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, hash[:])
	if err != nil {
		return "", err
	}
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return input + "." + b64.EncodeToString(sig), nil
}
