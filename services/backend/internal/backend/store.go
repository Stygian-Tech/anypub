package backend

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"sort"
	"strings"
	"time"
)

type Row = map[string]any
type Store struct{ DB *sql.DB }

func uuid() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return strings.ToUpper(h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:])
}
func OpenStore(path string) (*Store, error) {
	db, e := sql.Open("sqlite3", path+"?_busy_timeout=10000&_foreign_keys=on&_journal_mode=WAL")
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{db}
	if e = s.migrate(context.Background()); e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) migrate(ctx context.Context) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	tables := make([]string, 0, len(schema))
	for t := range schema {
		tables = append(tables, t)
	}
	sort.Strings(tables)
	for _, t := range tables {
		cols := schema[t]
		names := make([]string, 0, len(cols))
		for c := range cols {
			names = append(names, c)
		}
		sort.Strings(names)
		defs := []string{}
		for _, c := range names {
			defs = append(defs, `"`+c+`" `+cols[c])
		}
		if _, e = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS "`+t+`" (`+strings.Join(defs, ",")+`)`); e != nil {
			return e
		}
		rows, e := tx.QueryContext(ctx, `PRAGMA table_info("`+t+`")`)
		if e != nil {
			return e
		}
		known := map[string]bool{}
		for rows.Next() {
			var cid, nn, pk int
			var name, typ string
			var d any
			if e = rows.Scan(&cid, &name, &typ, &nn, &d, &pk); e != nil {
				rows.Close()
				return e
			}
			known[name] = true
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, c := range names {
			if !known[c] {
				if _, e = tx.ExecContext(ctx, `ALTER TABLE "`+t+`" ADD COLUMN "`+c+`" `+strings.ReplaceAll(cols[c], " NOT NULL", "")); e != nil {
					return e
				}
			}
		}
	}
	for _, q := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS go_accounts_did ON linked_accounts(did)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS go_oauth_state ON oauth_states(state)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS go_publication_identity ON publication_cache(account_did,uri)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS go_session_hash ON browser_sessions(token_hash)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS go_calendar_draft ON calendar_event_links(draft_id)`,
		`CREATE INDEX IF NOT EXISTS go_scheduled_drafts ON drafts(status,scheduled_at)`,
	} {
		if _, e = tx.ExecContext(ctx, q); e != nil {
			return e
		}
	}
	// Fluent's _fluent_migrations is intentionally preserved. Column inspection also supports
	// databases stopped between historical Fluent migrations without replaying destructive DDL.
	return tx.Commit()
}
func (s *Store) Rows(ctx context.Context, table, where string, args ...any) ([]Row, error) {
	if _, ok := schema[table]; !ok {
		return nil, fmt.Errorf("unknown table %s", table)
	}
	rows, e := s.DB.QueryContext(ctx, `SELECT * FROM "`+table+`" `+where, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	out := []Row{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range vals {
			ptr[i] = &vals[i]
		}
		if e = rows.Scan(ptr...); e != nil {
			return nil, e
		}
		r := Row{}
		for i, c := range cols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			r[c] = v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) One(ctx context.Context, table, where string, args ...any) (Row, error) {
	rows, e := s.Rows(ctx, table, where, args...)
	if e != nil {
		return nil, e
	}
	if len(rows) == 0 {
		return nil, sql.ErrNoRows
	}
	return rows[0], nil
}
func (s *Store) Save(ctx context.Context, table string, r Row) error {
	if r["id"] == nil || r["id"] == "" {
		r["id"] = uuid()
	}
	cols, ok := schema[table]
	if !ok {
		return errors.New("unknown table")
	}
	keys := []string{}
	for k := range r {
		if _, ok := cols[k]; ok {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	args := []any{}
	quoted, qs, updates := []string{}, []string{}, []string{}
	for _, k := range keys {
		quoted = append(quoted, `"`+k+`"`)
		qs = append(qs, "?")
		updates = append(updates, `"`+k+`"=excluded."`+k+`"`)
		args = append(args, r[k])
	}
	_, e := s.DB.ExecContext(ctx, `INSERT INTO "`+table+`" (`+strings.Join(quoted, ",")+`) VALUES (`+strings.Join(qs, ",")+`) ON CONFLICT(id) DO UPDATE SET `+strings.Join(updates, ","), args...)
	return e
}
func (s *Store) Delete(ctx context.Context, table, id string) error {
	if _, ok := schema[table]; !ok {
		return errors.New("unknown table")
	}
	_, e := s.DB.ExecContext(ctx, `DELETE FROM "`+table+`" WHERE id=?`, id)
	return e
}
func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func num(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	}
	return 0
}
func now() float64 { return float64(time.Now().UnixNano()) / 1e9 }

// Fluent SQLite stores Date as Unix seconds (not Foundation's 2001 reference epoch).
func date(v any) time.Time {
	switch x := v.(type) {
	case float64:
		return time.Unix(0, int64(x*1e9)).UTC()
	case int64:
		return time.Unix(x, 0).UTC()
	case string:
		for _, f := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05"} {
			if t, e := time.Parse(f, x); e == nil {
				return t.UTC()
			}
		}
	}
	return time.Time{}
}
func iso(v any) any {
	if v == nil {
		return nil
	}
	t := date(v)
	if t.IsZero() {
		return nil
	}
	return t.Format(time.RFC3339Nano)
}
func snakeToCamel(k string) string {
	p := strings.Split(k, "_")
	for i := 1; i < len(p); i++ {
		switch p[i] {
		case "did", "uri", "url", "cid", "id", "json":
			p[i] = strings.ToUpper(p[i])
		default:
			p[i] = strings.ToUpper(p[i][:1]) + p[i][1:]
		}
	}
	return strings.Join(p, "")
}
func response(r Row) Row {
	out := Row{}
	for k, v := range r {
		if strings.HasSuffix(k, "_at") {
			v = iso(v)
		}
		out[snakeToCamel(k)] = v
	}
	return out
}
