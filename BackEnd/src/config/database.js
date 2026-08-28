const { Pool } = require('pg')

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
            monthly_limit INTEGER NOT NULL DEFAULT 20,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `)

    await query(`
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            review TEXT NOT NULL,
            model VARCHAR(120) NOT NULL,
            depth VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `)
}

module.exports = {
    pool,
    query,
    initDatabase
}
