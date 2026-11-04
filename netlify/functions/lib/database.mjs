import { neon } from "@neondatabase/serverless";

const DEFAULT_OPTIONS = [
  ["option_a", "Option A", 2],
  ["option_b", "Option B", 2],
  ["option_c", "Option C", 2],
  ["option_d", "Option D", 2],
  ["option_e", "Option E", 2],
];

let sql;
let schemaReady;

async function initializeSchema(database) {
  await database`
    CREATE TABLE IF NOT EXISTS options (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      taken INTEGER NOT NULL DEFAULT 0 CHECK (taken >= 0 AND taken <= capacity)
    )
  `;
  await database`
    CREATE TABLE IF NOT EXISTS submissions (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      option_id TEXT NOT NULL REFERENCES options(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await database`
    INSERT INTO options (id, label, capacity)
    VALUES
      ('option_a', 'Option A', 2),
      ('option_b', 'Option B', 2),
      ('option_c', 'Option C', 2),
      ('option_d', 'Option D', 2),
      ('option_e', 'Option E', 2)
    ON CONFLICT (id) DO NOTHING
  `;
  await database`
    CREATE OR REPLACE FUNCTION reserve_slot(
      p_name TEXT,
      p_email TEXT,
      p_option_id TEXT
    )
    RETURNS TABLE(status TEXT, option_label TEXT)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      option_record options%ROWTYPE;
    BEGIN
      SELECT * INTO option_record
      FROM options
      WHERE id = p_option_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'missing'::TEXT, NULL::TEXT;
        RETURN;
      END IF;

      IF EXISTS (SELECT 1 FROM submissions WHERE email = p_email) THEN
        RETURN QUERY SELECT 'duplicate'::TEXT, option_record.label;
        RETURN;
      END IF;

      IF option_record.taken >= option_record.capacity THEN
        RETURN QUERY SELECT 'full'::TEXT, option_record.label;
        RETURN;
      END IF;

      BEGIN
        INSERT INTO submissions (name, email, option_id)
        VALUES (p_name, p_email, p_option_id);
      EXCEPTION WHEN unique_violation THEN
        RETURN QUERY SELECT 'duplicate'::TEXT, option_record.label;
        RETURN;
      END;

      UPDATE options SET taken = taken + 1 WHERE id = p_option_id;
      RETURN QUERY SELECT 'ok'::TEXT, option_record.label;
    END;
    $$
  `;
  await database`
    CREATE OR REPLACE FUNCTION cancel_slot(p_submission_id BIGINT)
    RETURNS TABLE(status TEXT)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      selected_option_id TEXT;
    BEGIN
      DELETE FROM submissions
      WHERE id = p_submission_id
      RETURNING option_id INTO selected_option_id;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'missing'::TEXT;
        RETURN;
      END IF;

      UPDATE options SET taken = taken - 1 WHERE id = selected_option_id;
      RETURN QUERY SELECT 'ok'::TEXT;
    END;
    $$
  `;
}

export async function getDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  if (!schemaReady) {
    schemaReady = initializeSchema(sql).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
  return sql;
}

export { DEFAULT_OPTIONS };