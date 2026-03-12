import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  }
};

const Registration = mongoose.model('Registration', new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    status: String,
}, { timestamps: false, strict: false }));

const Payment = mongoose.model('Payment', new mongoose.Schema({
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration' },
}, { timestamps: false, strict: false }));

const Course = mongoose.model('Course', new mongoose.Schema({ code: String }, { strict: false }));
const Batch = mongoose.model('Batch', new mongoose.Schema({ name: String }, { strict: false }));

const runCheck = async () => {
  await connectDB();
  
  try {
    const course = await Course.findOne({ code: 'B Tự Động (B1)' });
    console.log(`Course: B Tự Động (B1) -> ${course._id}`);
    
    const pendingQuery = {
      courseId: course._id,
      status: { $in: ['NEW', 'PROCESSING', 'WAITING'] },
    };
    
    const pendingRegistrations = await Registration.find(pendingQuery);
    console.log(`Found ${pendingRegistrations.length} total pending/new/waiting registrations for this course.`);

    const withNoBatch = pendingRegistrations.filter(r => !r.batchId);
    console.log(`Of those, ${withNoBatch.length} have NO batch assigned.`);

    const withBatch = pendingRegistrations.filter(r => r.batchId);
    console.log(`And ${withBatch.length} ALREADY HAVE a batch assigned:`);
    for (const r of withBatch) {
        const batch = await Batch.findById(r.batchId);
        console.log(`  - Reg ID ${r._id} -> Batch ${batch?.name || r.batchId}`);
    }

    const pendingIds = pendingRegistrations.map(r => r._id);
    const paidRegistrationIds = await Payment.distinct('registrationId', {
      registrationId: { $in: pendingIds }
    });
    
    console.log(`Of the ${pendingRegistrations.length} pending, ${paidRegistrationIds.length} have at least one payment record.`);

    const paidSet = new Set(paidRegistrationIds.map(String));
    const readyToEnroll = withNoBatch.filter(reg => paidSet.has(String(reg._id)));
    
    console.log(`FINAL ELIGIBLE (No batch AND has payment): ${readyToEnroll.length}`);

  } catch (error) {
     console.error('Script failed:', error);
  } finally {
     mongoose.connection.close();
  }
};

runCheck();
