package atproto

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
)

// RecordCID computes CIDv1/dag-cbor/sha2-256, preserving integer precision.
func RecordCID(record any) (string, error) {
	data, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var v any
	if err = d.Decode(&v); err != nil {
		return "", err
	}
	block, err := dagCBOR(nil, v)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(block)
	return "b" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(append([]byte{1, 0x71, 0x12, 0x20}, hash[:]...))), nil
}
func cborUnsigned(dst []byte, major byte, v uint64) []byte {
	p := major << 5
	switch {
	case v < 24:
		return append(dst, p|byte(v))
	case v <= 255:
		return append(dst, p|24, byte(v))
	case v <= 65535:
		return binary.BigEndian.AppendUint16(append(dst, p|25), uint16(v))
	case v <= 0xffffffff:
		return binary.BigEndian.AppendUint32(append(dst, p|26), uint32(v))
	default:
		return binary.BigEndian.AppendUint64(append(dst, p|27), v)
	}
}
func dagCBOR(dst []byte, value any) ([]byte, error) {
	switch v := value.(type) {
	case nil:
		return append(dst, 0xf6), nil
	case bool:
		if v {
			return append(dst, 0xf5), nil
		}
		return append(dst, 0xf4), nil
	case string:
		return append(cborUnsigned(dst, 3, uint64(len(v))), []byte(v)...), nil
	case json.Number:
		n, err := strconv.ParseInt(string(v), 10, 64)
		if err != nil {
			return nil, errors.New("ATProto requires signed 64-bit integers")
		}
		if n >= 0 {
			return cborUnsigned(dst, 0, uint64(n)), nil
		}
		return cborUnsigned(dst, 1, uint64(-(n + 1))), nil
	case []any:
		dst = cborUnsigned(dst, 4, uint64(len(v)))
		for _, child := range v {
			var err error
			dst, err = dagCBOR(dst, child)
			if err != nil {
				return nil, err
			}
		}
		return dst, nil
	case map[string]any:
		if len(v) == 1 {
			if link, ok := v["$link"].(string); ok {
				if !strings.HasPrefix(link, "b") {
					return nil, errors.New("invalid CID link")
				}
				raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(link[1:]))
				if err != nil || len(raw) < 4 || raw[0] != 1 {
					return nil, errors.New("invalid CID link")
				}
				dst = cborUnsigned(dst, 6, 42)
				dst = cborUnsigned(dst, 2, uint64(len(raw)+1))
				return append(append(dst, 0), raw...), nil
			}
		}
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			if len(keys[i]) != len(keys[j]) {
				return len(keys[i]) < len(keys[j])
			}
			return keys[i] < keys[j]
		})
		dst = cborUnsigned(dst, 5, uint64(len(keys)))
		for _, k := range keys {
			dst, _ = dagCBOR(dst, k)
			var err error
			dst, err = dagCBOR(dst, v[k])
			if err != nil {
				return nil, err
			}
		}
		return dst, nil
	default:
		return nil, errors.New("unsupported record value")
	}
}

// NewTID returns a timestamp record key. Callers coordinate monotonicity for
// multiple keys generated within one microsecond.
func NewTID() (string, error) {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return TIDAt(time.Now(), binary.BigEndian.Uint16(b[:])), nil
}
func TIDAt(now time.Time, clock uint16) string {
	us := now.UnixMicro()
	if us < 0 {
		us = 0
	}
	v := (uint64(us) << 10) | uint64(clock&1023)
	const alphabet = "234567abcdefghijklmnopqrstuvwxyz"
	var b [13]byte
	for i := 12; i >= 0; i-- {
		b[i] = alphabet[v&31]
		v >>= 5
	}
	return string(b[:])
}
