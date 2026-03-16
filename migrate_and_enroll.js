import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { autoEnrollStudents } from './src/services/enrollment.service.js';
import Registration from './src/models/Registration.js';
import Payment from './src/models/Payment.js';
import Course from './src/models/Course.js';
import User from './src/models/User.js';
import Batch from './src/models/Batch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
};

const runMigration = async () => {
  await connectDB();
  
  try {
    // 1. Find all pending registrations
    const pendingRegistrations = await Registration.find({
        status: { $in: ['NEW', 'PROCESSING', 'WAITING'] },
        batchId: null
    }).populate('courseId').lean();
    
    console.log(`Found ${pendingRegistrations.length} pending registrations without a batch.`);
    
    // 2. Find which ones already have a payment
    const pendingIds = pendingRegistrations.map(r => r._id);
    const paidRegistrationIds = await mongoose.connection.db.collection('payments').distinct('registrationId', {
      registrationId: { $in: pendingIds }
    });
    const paidSet = new Set(paidRegistrationIds.map(String));
    
    let createdPayments = 0;
    
    let mockPayments = [];
    
    // 3. Create mock payments for the rest
    for (const reg of pendingRegistrations) {
        let regId = reg._id;
        
        if (typeof regId === 'object' && regId !== null && regId.$oid) {
            regId = regId.$oid;
        }
        
        regId = String(regId);

        if (!paidSet.has(regId)) {
            // estimate course cost to 5_000_000 default for script
            const courseCost = 5000000;
            
            mockPayments.push({
                registrationId: typeof reg._id === 'object' ? reg._id : regId,
                amount: courseCost,
                method: 'TRANSFER',
                receivedBy: 'SYSTEM',
                note: 'Thanh toán tự động (Migration)',
                paidAt: new Date()
            });
            createdPayments++;
        }
    }
    
    if (mockPayments.length > 0) {
        await mongoose.connection.db.collection('payments').insertMany(mockPayments);
    }
    
    console.log(`Created ${createdPayments} new mock payment records.`);
    
    // 4. Run auto-enroll for all unique courses involved
    const courseIdsToEnroll = [...new Set(pendingRegistrations.map(r => String(r.courseId?._id || r.courseId)))];
    
    for (const courseId of courseIdsToEnroll) {
        if (courseId && courseId !== "undefined") {
            console.log(`\nRunning autoEnrollStudents for course: ${courseId}`);
            const result = await autoEnrollStudents(courseId, {});
            console.log(result.message);
        }
    }
    
    console.log('\nMigration complete.');

  } catch (error) {
     console.error('Migration failed:', error);
  } finally {
     mongoose.connection.close();
     process.exit(0);
  }
};

runMigration();
