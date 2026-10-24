require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');
const { initDatabase } = require('./config/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

if (!process.env.JWT_SECRET) {
    logger.error('Missing required environment variable: JWT_SECRET');
    process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    logger.warn('JWT_SECRET should be at least 32 characters long for security');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway/Render/Heroku proxy — required for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for development
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url} - ${req.ip}`);
    next();
});

// Apply rate limiting to all routes
app.use('/api/', apiLimiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Swagger Documentation
const { swaggerUi, swaggerSpec } = require('./config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use('/api/admin', require('./routes/admin'));
app.use('/api/donors', require('./routes/donors'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/donor-auth', require('./routes/donorAuth'));
app.use('/api/neon', require('./routes/neon'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Handle 404
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

let server;

if (require.main === module) {
    initDatabase()
        .then(() => {
            server = app.listen(PORT, () => {
                logger.info(`🚀 Server running on http://localhost:${PORT}`);
                logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            });
        })
        .catch((error) => {
            logger.error('Neon Postgres initialization failed:', error);
            process.exit(1);
        });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    if (!server) return process.exit(0);
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    if (!server) return process.exit(0);
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err);
    process.exit(1);
});

module.exports = app;
