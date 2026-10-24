const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { validate, validationRules } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimiter');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next(new AppError('Authentication required', 401));
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        next(new AppError('Invalid or expired token', 403));
    }
}

// Admin Login
router.post('/login', authLimiter, validate(validationRules.adminLogin), asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    const { rows } = await pool.query(
        'SELECT id, username, password_hash, role FROM admins WHERE username = $1 LIMIT 1',
        [username]
    );
    if (rows.length === 0) throw new AppError('Invalid credentials', 401);

    const admin = rows[0];

    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) throw new AppError('Invalid credentials', 401);

    const token = jwt.sign(
        { username: admin.username, id: admin.id, role: admin.role, type: 'admin' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );

    logger.info(`Admin login successful: ${username}`);
    res.json({
        success: true,
        message: 'Login successful',
        token,
        user: { id: admin.id, username: admin.username, role: admin.role }
    });
}));

// Get Analytics
router.get('/analytics', authenticateToken, asyncHandler(async (req, res) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const [totalDonors, availableDonors, totalRequests, pendingRequests, donorsByBloodGroup, requestsByBloodGroup, requestsByStatus, recentDonations] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM donors'),
        pool.query('SELECT COUNT(*)::int AS count FROM donors WHERE availability = TRUE'),
        pool.query('SELECT COUNT(*)::int AS count FROM blood_requests'),
        pool.query("SELECT COUNT(*)::int AS count FROM blood_requests WHERE status = 'Pending'"),
        pool.query('SELECT blood_group, COUNT(*)::int AS count FROM donors GROUP BY blood_group'),
        pool.query('SELECT blood_group, COUNT(*)::int AS count FROM blood_requests GROUP BY blood_group'),
        pool.query('SELECT status, COUNT(*)::int AS count FROM blood_requests GROUP BY status'),
        pool.query('SELECT COUNT(*)::int AS count FROM donations WHERE donation_date >= $1', [thirtyDaysAgoStr])
    ]);

    res.json({
        success: true,
        data: {
            totalDonors: totalDonors.rows,
            availableDonors: availableDonors.rows,
            totalRequests: totalRequests.rows,
            pendingRequests: pendingRequests.rows,
            donorsByBloodGroup: donorsByBloodGroup.rows,
            requestsByBloodGroup: requestsByBloodGroup.rows,
            requestsByStatus: requestsByStatus.rows,
            recentDonations: recentDonations.rows
        }
    });
}));

// Get all admins (super_admin only)
router.get('/users', authenticateToken, asyncHandler(async (req, res) => {
    if (req.user.role !== 'super_admin') throw new AppError('Access denied. Super admin only.', 403);

    const { rows } = await pool.query('SELECT id, username, role, email, created_at, updated_at FROM admins ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
}));

// Create new admin (super_admin only)
router.post('/users', authenticateToken, asyncHandler(async (req, res) => {
    if (req.user.role !== 'super_admin') throw new AppError('Access denied. Super admin only.', 403);

    const { username, password, email, role } = req.body;
    if (!username || !password) throw new AppError('Username and password are required', 400);

    // Check duplicate
    const existing = await pool.query('SELECT 1 FROM admins WHERE username = $1 LIMIT 1', [username]);
    if (existing.rowCount > 0) throw new AppError('Username already exists', 400);

    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
        'INSERT INTO admins (username, password_hash, email, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, hashedPassword, email || null, role || 'admin']
    );

    logger.info(`New admin created: ${username} by ${req.user.username}`);
    res.json({ success: true, message: 'Admin created successfully', id: rows[0].id });
}));

module.exports = router;
