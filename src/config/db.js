import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.DB_NAME || 'banglaixe';

/**
 * Kết nối đến MongoDB Atlas bằng Mongoose
 */
export async function connectDB() {
  try {
    // Kiểm tra xem đã kết nối chưa
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB đã được kết nối');
      return;
    }

    // Kết nối đến MongoDB
    await mongoose.connect(MONGODB_URI, {
      dbName: DB_NAME,
      serverSelectionTimeoutMS: 5000,
    });

    console.log('✅ Đã kết nối thành công đến MongoDB Atlas');

    // Xử lý sự kiện disconnect
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ Đã mất kết nối MongoDB');
    });

    // Xử lý lỗi
    mongoose.connection.on('error', (error) => {
      console.error('❌ Lỗi MongoDB:', error);
    });

    // Xử lý khi app tắt
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('✅ Đã đóng kết nối MongoDB');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error);
    process.exit(1);
  }
}

export default mongoose;

