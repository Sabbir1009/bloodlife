const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const logger = require('../utils/logger');

if (!process.env.DATABASE_URL) {
    throw new Error('Missing required environment variable: DATABASE_URL');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 5)
});

pool.on('error', (error) => logger.error('Unexpected PostgreSQL pool error:', error));

async function initDatabase() {
    const schemaPath = path.join(__dirname, '../database/neon-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);

    const passwordHash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@12345', 10);
    await pool.query(
        `INSERT INTO admins (username, password_hash, role)
         VALUES ($1, $2, 'super_admin')
         ON CONFLICT (username) DO NOTHING`,
        [process.env.DEFAULT_ADMIN_USERNAME || 'admin', passwordHash]
    );

    logger.info('Neon Postgres schema initialized.');
}

module.exports = { pool, initDatabase };
