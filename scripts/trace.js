import fs from 'fs';
import path from 'path';

const downloadsDir = '/Users/nguyenminhanh/Downloads';
const registrationsFile = path.join(downloadsDir, 'banglaixe.registrations.json');
const paymentsFile = path.join(downloadsDir, 'banglaixe.payments.json');

const registrations = JSON.parse(fs.readFileSync(registrationsFile, 'utf8'));
const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));

// Find the 8 payments
console.log(`Analyzing ${payments.length} payments.`);

let validForEnrollment = 0;

for (const p of payments) {
    const regId = p.registrationId?.$oid || p.registrationId;
    const reg = registrations.find(r => (r._id?.$oid || r._id) === regId);
    if (!reg) {
        console.log(`Payment ${p._id?.$oid || p._id} points to missing registration ${regId}`);
        continue;
    }
    
    console.log(`Payment ${p._id?.$oid || p._id} -> Registration ${regId}:`);
    console.log(`  Status: ${reg.status}`);
    console.log(`  CourseId: ${reg.courseId?.$oid || reg.courseId || "MISSING"}`);
    console.log(`  BatchId: ${reg.batchId?.$oid || reg.batchId || "MISSING"}`);
    
    if (reg.courseId && ['NEW', 'PROCESSING', 'WAITING'].includes(reg.status) && (!reg.batchId || reg.batchId === null)) {
        validForEnrollment++;
    }
}

console.log(`\nTotal registrations valid for auto-enrollment (paid + valid status + no batch + has courseId): ${validForEnrollment}`);
