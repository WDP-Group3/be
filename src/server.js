import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import apiRoutes from './routes/index.js';
import { initCloudinary, isCloudinaryConfigured, pingCloudinary } from './services/cloudinary.service.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối MongoDB
connectDB();

// Cloudinary (optional)
initCloudinary();
if (isCloudinaryConfigured()) {
  console.log('☁️  Cloudinary: CLOUDINARY_URL is set');
} else {
  console.log('☁️  Cloudinary: not configured (CLOUDINARY_URL is missing)');
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Backend API',
    status: 'success',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    database: 'connected',
    cloudinaryConfigured: isCloudinaryConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// Cloudinary health check (pings Cloudinary API)
app.get('/health/cloudinary', async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        status: 'error',
        message: 'Cloudinary is not configured (missing CLOUDINARY_URL)',
      });
    }

    const result = await pingCloudinary();
    return res.json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Cloudinary ping failed',
    });
  }
});

// API Routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    status: 'error',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    status: 'error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

