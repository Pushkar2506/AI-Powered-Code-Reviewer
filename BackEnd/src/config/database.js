const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = require('./admin')

function getDatabaseConfig() {
    if (!process.env.DATABASE_URL) {
        return {}
    }

    const url = new URL(process.env.DATABASE_URL)
    const schema = url.searchParams.get('schema') || 'public'

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
        throw new Error('DATABASE_URL schema must be a valid PostgreSQL identifier')
    }

    url.searchParams.delete('schema')

    return {
        connectionString: url.toString(),
        options: `-c search_path=${schema}`,
        schema
    }
}

const databaseConfig = getDatabaseConfig()

const pool = new Pool({
    connectionString: databaseConfig.connectionString,
    options: databaseConfig.options
})

async function query(text, params) {
    const result = await pool.query(text, params)
    return result
}

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        throw new Error('Missing required environment variable: DATABASE_URL')
    }

    await query(`CREATE SCHEMA IF NOT EXISTS ${databaseConfig.schema};`)

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'user',
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            monthly_limit INTEGER NOT NULL DEFAULT 20,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `)

    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`)

    const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    const monthlyLimit = Number(process.env.DEFAULT_MONTHLY_LIMIT) || 20

    await query(
        `INSERT INTO users (name, email, password_hash, role, status, monthly_limit)
         VALUES ($1, $2, $3, 'admin', 'active', $4)
         ON CONFLICT (email)
         DO UPDATE SET
            name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            role = 'admin',
            status = 'active',
            monthly_limit = GREATEST(users.monthly_limit, EXCLUDED.monthly_limit)`,
        [ADMIN_NAME, ADMIN_EMAIL, adminPasswordHash, monthlyLimit]
    )

    await query(
        `UPDATE users
         SET role = 'user'
         WHERE email <> $1
         AND role = 'admin'`,
        [ADMIN_EMAIL]
    )

    await query(`
        CREATE TABLE IF NOT EXISTS projects (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(160) NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `)

    await query(`
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            code TEXT NOT NULL,
            review TEXT NOT NULL,
            model VARCHAR(120) NOT NULL,
            depth VARCHAR(20) NOT NULL,
            source_type VARCHAR(40) NOT NULL DEFAULT 'paste',
            source_url TEXT,
            score INTEGER NOT NULL DEFAULT 0,
            fixed_code TEXT,
            checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
            comments JSONB NOT NULL DEFAULT '[]'::jsonb,
            files JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `)

    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'paste';`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source_url TEXT;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS fixed_code TEXT;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb;`)
    await query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb;`)
}

module.exports = {
    pool,
    query,
    initDatabase
}
