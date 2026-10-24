const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { validate, validationRules } = require('../middleware/validator');
const { registerLimiter } = require('../middleware/rateLimiter');
const { isDonorEligible, getDaysUntilEligible, getCompatibleBloodGroups } = require('../utils/bloodCompatibility');
const notificationService = require('../utils/notificationService');
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

// Get all donors with pagination
router.get('/', validate(validationRules.pagination), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const bloodGroup = req.query.blood_group;
    const availability = req.query.availability;
    const location = req.query.location;

    const filters = [];
    const values = [];
    if (bloodGroup) {
        values.push(bloodGroup);
        filters.push(`blood_group = $${values.length}`);
    }
    if (availability !== undefined) {
        values.push(availability === '1' || availability === 'true');
        filters.push(`availability = $${values.length}`);
    }
    if (location) {
        values.push(`%${location}%`);
        filters.push(`address ILIKE $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM donors ${where}`, values);
    const total = countResult.rows[0].count;
    const { rows: results } = await pool.query(
        `SELECT * FROM donors ${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );

    res.json({
        success: true,
        data: results,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
}));

// Get donor by ID
router.get('/:id', validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM donors WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Donor not found', 404);
    res.json({ success: true, data: rows[0] });
}));

// Get donor eligibility
router.get('/:id/eligibility', validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT last_donation_date FROM donors WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new AppError('Donor not found', 404);

    const { last_donation_date } = rows[0];
    const eligible = isDonorEligible(last_donation_date);
    const daysUntilEligible = getDaysUntilEligible(last_donation_date);

    res.json({
        success: true,
        data: {
            eligible,
            last_donation_date,
            days_until_eligible: daysUntilEligible,
            message: eligible ? 'Eligible to donate' : `Not eligible. Can donate after ${daysUntilEligible} days`
        }
    });
}));

// Get compatible donors for a blood group
router.get('/compatible/:bloodGroup', asyncHandler(async (req, res) => {
    const { bloodGroup } = req.params;
    const compatibleGroups = getCompatibleBloodGroups(bloodGroup);
    if (compatibleGroups.length === 0) throw new AppError('Invalid blood group', 400);

    const { rows } = await pool.query(
        'SELECT * FROM donors WHERE blood_group = ANY($1::varchar[]) AND availability = TRUE ORDER BY created_at DESC',
        [compatibleGroups]
    );

    res.json({
        success: true,
        blood_group: bloodGroup,
        compatible_groups: compatibleGroups,
        data: rows
    });
}));

// Register new donor
router.post('/register', registerLimiter, validate(validationRules.donorRegister), asyncHandler(async (req, res) => {
    const { fullname, age, gender, blood_group, phone, email, address, last_donation_date, availability } = req.body;

    // Check duplicate email
    const existing = await pool.query('SELECT 1 FROM donors WHERE email = $1 LIMIT 1', [email]);
    if (existing.rowCount > 0) throw new AppError('Email already registered', 400);

    const { rows } = await pool.query(
        `INSERT INTO donors (fullname, age, gender, blood_group, phone, email, address, last_donation_date, availability)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [fullname, parseInt(age), gender, blood_group, phone, email, address, last_donation_date || null, availability !== undefined ? availability : true]
    );

    logger.info(`New donor registered: ${email}`);
    notificationService.sendWelcomeEmail(email, fullname).catch(e => logger.error('Welcome email failed:', e));

    res.json({ success: true, message: 'Donor registered successfully', id: rows[0].id });
}));

// Update donor
router.put('/:id', authenticateToken, validate(validationRules.donorUpdate), asyncHandler(async (req, res) => {
    const { fullname, age, gender, blood_group, phone, email, address, last_donation_date, availability } = req.body;
    const { rows: existingDonors } = await pool.query('SELECT email FROM donors WHERE id = $1', [req.params.id]);
    if (existingDonors.length === 0) throw new AppError('Donor not found', 404);

    // Check duplicate email (exclude self)
    if (email && email !== existingDonors[0].email) {
        const existing = await pool.query('SELECT 1 FROM donors WHERE email = $1 LIMIT 1', [email]);
        if (existing.rowCount > 0) throw new AppError('Email already exists', 400);
    }

    const updates = { fullname, age, gender, blood_group, phone, email, address, last_donation_date, availability };
    const fields = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (fields.length === 0) throw new AppError('No fields to update', 400);

    const values = fields.map(([field, value]) => {
        if (field === 'age') return parseInt(value);
        if (field === 'availability') return value === true || value === 1 || value === '1' || value === 'true';
        return value;
    });
    const assignments = fields.map(([field], index) => `${field} = $${index + 1}`);
    assignments.push('updated_at = NOW()');
    values.push(req.params.id);
    await pool.query(
        `UPDATE donors SET ${assignments.join(', ')} WHERE id = $${values.length}`,
        values
    );

    logger.info(`Donor updated: ID ${req.params.id}`);
    res.json({ success: true, message: 'Donor updated successfully' });
}));

// Update donor availability
router.patch('/:id/availability', authenticateToken, validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const { availability } = req.body;
    if (typeof availability !== 'boolean' && typeof availability !== 'number') {
        throw new AppError('Availability must be boolean or number (0/1)', 400);
    }

    const normalizedAvailability = availability === true || availability === 1 || availability === '1' || availability === 'true';
    const result = await pool.query(
        'UPDATE donors SET availability = $1, updated_at = NOW() WHERE id = $2',
        [normalizedAvailability, req.params.id]
    );
    if (result.rowCount === 0) throw new AppError('Donor not found', 404);
    logger.info(`Donor availability updated: ID ${req.params.id}`);
    res.json({ success: true, message: 'Availability updated' });
}));

// Delete donor
router.delete('/:id', authenticateToken, validate(validationRules.idParam), asyncHandler(async (req, res) => {
    const result = await pool.query('DELETE FROM donors WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) throw new AppError('Donor not found', 404);
    logger.info(`Donor deleted: ID ${req.params.id}`);
    res.json({ success: true, message: 'Donor deleted successfully' });
}));

module.exports = router;
