const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

function serviceUrl(base, path) {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next(new AppError('Authentication required', 401));

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (error) {
        next(new AppError('Invalid or expired token', 403));
    }
}

function requireAdmin(req, res, next) {
    if (req.user.type !== 'admin') return next(new AppError('Admin access only', 403));
    next();
}

router.get('/auth/session', asyncHandler(async (req, res) => {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    if (!baseUrl) throw new AppError('Neon Auth is not configured', 503);

    const response = await fetch(serviceUrl(baseUrl, 'get-session'), {
        headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new AppError(`Neon Auth returned HTTP ${response.status}`, 502);

    const session = await response.json();
    res.json({ success: true, authenticated: Boolean(session?.user) });
}));

router.get('/functions/hello', asyncHandler(async (req, res) => {
    const functionUrl = process.env.NEON_FUNCTION_HELLO_BASE_URL;
    if (!functionUrl) throw new AppError('Neon hello function is not configured', 503);

    const response = await fetch(functionUrl, { signal: AbortSignal.timeout(10000) });
    const message = await response.text();
    if (!response.ok) throw new AppError(`Neon Function returned HTTP ${response.status}`, 502);
    res.json({ success: true, message });
}));

router.get('/realtime/donors', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
    const realtimeUrl = process.env.NEON_REALTIME_URL;
    const realtimeSecret = process.env.NEON_REALTIME_SECRET;
    if (!realtimeUrl || !realtimeSecret) throw new AppError('Neon Realtime is not configured', 503);

    const { createRealtime, rawSql } = await import('@neon/realtime/server');
    const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
    const realtime = createRealtime({ secret: realtimeSecret, db: database });
    const query = rawSql(
        'SELECT id, fullname, blood_group, availability, created_at FROM donors ORDER BY created_at DESC, id LIMIT 100'
    );
    const sealedQuery = await realtime.seal({ query });
    res.json({ success: true, url: realtimeUrl, query: sealedQuery });
}));

router.post('/ai/chat', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
    const gatewayUrl = process.env.NEON_AI_GATEWAY_BASE_URL;
    const gatewayToken = process.env.NEON_AI_GATEWAY_TOKEN;
    if (!gatewayUrl || !gatewayToken) throw new AppError('Neon AI Gateway is unavailable on the current Neon plan', 503);

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
        throw new AppError('Provide between 1 and 20 chat messages', 400);
    }
    if (messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
        throw new AppError('Each message must have a supported role and string content', 400);
    }

    const response = await fetch(serviceUrl(gatewayUrl, 'v1/chat/completions'), {
        method: 'POST',
        headers: {
            authorization: `Bearer ${gatewayToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ model: process.env.NEON_AI_MODEL || 'gpt-5-mini', messages }),
        signal: AbortSignal.timeout(60000)
    });
    const result = await response.json();
    if (!response.ok) throw new AppError(`Neon AI Gateway returned HTTP ${response.status}`, 502);
    res.json({ success: true, data: result });
}));

module.exports = router;