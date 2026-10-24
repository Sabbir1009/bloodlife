const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { validate, validationRules } = require('../middleware/validator');
const { registerLimiter } = require('../middleware/rateLimiter');
const notificationService = require('../utils/notificationService');
const { getCompatibleBloodGroups } = require('../utils/bloodCompatibility');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

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

// Get all requests with pagination
router.get('/', validate(validationRules.pagination), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const bloodGroup = req.query.blood_group;
    const emergency = req.query.emergency;

    const filters = [];
    const values = [];
    if (status) {
        values.push(status);
        filters.push(`status = $${values.length}`);
    }
    if (bloodGroup) {
        values.push(bloodGroup);
        filters.push(`blood_group = $${values.length}`);
    }
    if (emergency !== undefined) {
        values.push(emergency === '1' || emergency === 'true');
        filters.push(`is_emergency = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM blood_requests ${where}`, values);
    const total = countResult.rows[0].count;
    const { rows } = await pool.query(
        `SELECT * FROM blood_requests ${where} ORDER BY is_emergency DESC, created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );

    res.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
}));

// Get request by ID
router.get('/:id', validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM blood_requests WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Request not found', 404);
    res.json({ success: true, data: rows[0] });
}));

// Create blood request
router.post('/', registerLimiter, validate(validationRules.bloodRequest), asyncHandler(async (req, res) => {
    const { patient_name, blood_group, units, hospital, phone, needed_date, is_emergency } = req.body;
    const isEmergency = is_emergency ? 1 : 0;

    const { rows } = await pool.query(
        `INSERT INTO blood_requests (patient_name, blood_group, units, hospital, phone, needed_date, is_emergency)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [patient_name, blood_group, parseInt(units), hospital, phone, needed_date, Boolean(isEmergency)]
    );
    const requestId = rows[0].id;

    logger.info(`New blood request created: ${blood_group} at ${hospital}`);

    // Notify compatible donors (async)
    const compatibleGroups = getCompatibleBloodGroups(blood_group);
    if (compatibleGroups.length > 0) {
        pool.query(
            `SELECT d.email, d.fullname FROM donors d
             INNER JOIN donor_accounts a ON a.donor_id = d.id
             WHERE d.blood_group = ANY($1::varchar[]) AND d.availability = TRUE`,
            [compatibleGroups]
        )
            .then(({ rows: matchingDonors }) => {
                const requestDetails = { patient_name, blood_group, units, hospital, phone, needed_date, is_emergency: isEmergency };
                matchingDonors.forEach(donor => {
                    notificationService.notifyDonorMatch(donor.email, donor.fullname, requestDetails)
                        .catch(e => logger.error(`Notification failed for ${donor.email}: ${e.message}`));
                });
                logger.info(`Notified ${matchingDonors.length} registered donors for request ID ${requestId}`);
            })
            .catch(e => logger.error('Donor query failed for notifications:', e.message));
    }

    res.json({ success: true, message: 'Request created successfully', id: requestId });
}));

// Update request status
router.put('/:id/status', authenticateToken, validate(validationRules.requestStatusUpdate), asyncHandler(async (req, res) => {
    const { status } = req.body;
    const result = await pool.query(
        'UPDATE blood_requests SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, req.params.id]
    );
    if (result.rowCount === 0) throw new AppError('Request not found', 404);
    logger.info(`Request ${req.params.id} status updated to ${status}`);

    res.json({ success: true, message: 'Request status updated', status });
}));

// Delete request
router.delete('/:id', authenticateToken, validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const result = await pool.query('DELETE FROM blood_requests WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) throw new AppError('Request not found', 404);
    logger.info(`Request deleted: ID ${req.params.id}`);
    res.json({ success: true, message: 'Request deleted successfully' });
}));

module.exports = router;
