const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { validate, validationRules, passwordRules } = require('../middleware/validator');
const { authLimiter, registerLimiter } = require('../middleware/rateLimiter');
const { body } = require('express-validator');
const { uploadProfilePicture } = require('../utils/upload');
const notificationService = require('../utils/notificationService');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

function authenticateDonor(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next(new AppError('Authentication required', 401));
    try {
        const user = jwt.verify(token, JWT_SECRET);
        if (user.type !== 'donor') return next(new AppError('Donor access only', 403));
        req.user = user;
        next();
    } catch (err) {
        next(new AppError('Invalid or expired token', 403));
    }
}

// Donor Registration (create account)
router.post('/register', registerLimiter, validate([
    body('donor_id').notEmpty().withMessage('Valid donor ID required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    passwordRules()
]), asyncHandler(async (req, res) => {
    const { donor_id, email, password } = req.body;

    const { rows: donors } = await pool.query('SELECT id, email, fullname FROM donors WHERE id = $1', [donor_id]);
    if (donors.length === 0 || donors[0].email !== email) {
        throw new AppError('Donor not found. Please register as donor first.', 404);
    }

    const existing = await pool.query(
        'SELECT 1 FROM donor_accounts WHERE donor_id = $1 OR email = $2 LIMIT 1',
        [donor_id, email]
    );
    if (existing.rowCount > 0) throw new AppError('Account already exists', 400);

    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
        'INSERT INTO donor_accounts (donor_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [donor_id, email, hashedPassword]
    );

    logger.info(`Donor account created: ${email}`);
    notificationService.sendWelcomeEmail(email, donors[0].fullname || 'Donor')
        .catch(e => logger.warn('Welcome email failed: ' + e.message));

    res.json({ success: true, message: 'Account created successfully. Please login.', id: rows[0].id });
}));

// Donor Login
router.post('/login', authLimiter, validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
]), asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const { rows: accounts } = await pool.query('SELECT * FROM donor_accounts WHERE email = $1 LIMIT 1', [email]);
    if (accounts.length === 0) throw new AppError('Invalid credentials', 401);

    const account = accounts[0];

    const validPassword = await bcrypt.compare(password, account.password_hash);
    if (!validPassword) throw new AppError('Invalid credentials', 401);

    const { rows: donors } = await pool.query('SELECT * FROM donors WHERE id = $1', [account.donor_id]);
    const donor = donors[0];

    const token = jwt.sign(
        { id: account.id, donor_id: account.donor_id, email: account.email, type: 'donor' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );

    pool.query('UPDATE donor_accounts SET last_login = NOW(), updated_at = NOW() WHERE id = $1', [account.id]).catch(() => {});

    logger.info(`Donor login: ${email}`);
    res.json({
        success: true,
        message: 'Login successful',
        token,
        donor: { id: account.donor_id, name: donor.fullname, blood_group: donor.blood_group }
    });
}));

// Get Donor Profile
router.get('/profile', authenticateDonor, asyncHandler(async (req, res) => {
    const { rows: donors } = await pool.query('SELECT * FROM donors WHERE id = $1', [req.user.donor_id]);
    if (donors.length === 0) throw new AppError('Profile not found', 404);

    const { rows: accounts } = await pool.query(
        'SELECT email, last_login FROM donor_accounts WHERE donor_id = $1 LIMIT 1',
        [req.user.donor_id]
    );

    const donorData = donors[0];
    const accountData = accounts[0] || {};

    res.json({
        success: true,
        data: {
            id: donorData.id,
            ...donorData,
            account_email: accountData.email,
            last_login: accountData.last_login
        }
    });
}));

// Update Donor Profile
router.put('/profile', authenticateDonor, validate([
    body('fullname').optional().trim().isLength({ min: 2, max: 100 }),
    body('age').optional().isInt({ min: 18, max: 65 }),
    body('gender').optional().isIn(['Male', 'Female', 'Other']),
    body('phone').optional().matches(/^[\d\s\+\-\(\)]+$/),
    body('address').optional().trim().isLength({ min: 5, max: 500 }),
    body('availability').optional().isBoolean()
]), asyncHandler(async (req, res) => {
    const { fullname, age, gender, phone, address, availability } = req.body;

    const updates = {};
    if (fullname !== undefined) updates.fullname = fullname;
    if (age !== undefined) updates.age = parseInt(age);
    if (gender !== undefined) updates.gender = gender;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (availability !== undefined) updates.availability = availability;

    if (Object.keys(updates).length === 0) throw new AppError('No fields to update', 400);

    const fields = Object.keys(updates);
    const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
    const values = fields.map(field => updates[field]);
    assignments.push('updated_at = NOW()');
    values.push(req.user.donor_id);
    const result = await pool.query(
        `UPDATE donors SET ${assignments.join(', ')} WHERE id = $${values.length}`,
        values
    );
    if (result.rowCount === 0) throw new AppError('Profile not found', 404);

    logger.info(`Donor profile updated: ID ${req.user.donor_id}`);
    res.json({ success: true, message: 'Profile updated successfully' });
}));

// Get Donation History
router.get('/donations', authenticateDonor, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
        'SELECT * FROM donations WHERE donor_id = $1 ORDER BY donation_date DESC',
        [req.user.donor_id]
    );

    res.json({
        success: true,
        data: rows
    });
}));

// Upload Profile Picture
router.post('/profile/picture', authenticateDonor, (req, res, next) => {
    uploadProfilePicture(req, res, (err) => {
        if (err) return next(err);
        next();
    });
}, asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('No image file provided', 400);

    const profilePicturePath = req.file.path;
    const result = await pool.query(
        'UPDATE donors SET profile_picture = $1, updated_at = NOW() WHERE id = $2',
        [profilePicturePath, req.user.donor_id]
    );
    if (result.rowCount === 0) throw new AppError('Profile not found', 404);

    logger.info(`Profile picture updated: donor ID ${req.user.donor_id}`);
    res.json({
        success: true,
        message: 'Profile picture updated successfully',
        profile_picture: profilePicturePath
    });
}));

// Get Eligibility Status
router.get('/eligibility', authenticateDonor, asyncHandler(async (req, res) => {
    const { isDonorEligible, getDaysUntilEligible } = require('../utils/bloodCompatibility');

    const { rows } = await pool.query('SELECT last_donation_date FROM donors WHERE id = $1', [req.user.donor_id]);
    if (rows.length === 0) throw new AppError('Donor not found', 404);

    const { last_donation_date } = rows[0];
    const eligible = isDonorEligible(last_donation_date);
    const daysUntil = getDaysUntilEligible(last_donation_date);

    res.json({
        success: true,
        data: {
            eligible,
            last_donation_date,
            days_until_eligible: daysUntil,
            next_donation_date: last_donation_date ?
                new Date(new Date(last_donation_date).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] :
                null
        }
    });
}));

module.exports = router;
