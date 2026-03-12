import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadsDir = '/Users/nguyenminhanh/Downloads';
const registrationsFile = path.join(downloadsDir, 'banglaixe.registrations.json');
const coursesFile = path.join(downloadsDir, 'banglaixe.courses.json');
const paymentsFile = path.join(downloadsDir, 'banglaixe.payments.json');
const batchesFile = path.join(downloadsDir, 'banglaixe.batches.json');

try {
  const registrations = JSON.parse(fs.readFileSync(registrationsFile, 'utf8'));
  const courses = JSON.parse(fs.readFileSync(coursesFile, 'utf8'));
  const payments = JSON.parse(fs.readFileSync(paymentsFile, 'utf8'));
  const batches = JSON.parse(fs.readFileSync(batchesFile, 'utf8'));

  console.log(`Total Registrations: ${registrations.length}`);
  console.log(`Total Courses: ${courses.length}`);
  console.log(`Total Payments: ${payments.length}`);
  console.log(`Total Batches: ${batches.length}`);

  // Analyze pending registrations
  const pendingRegs = registrations.filter(r => 
    ['NEW', 'PROCESSING', 'WAITING'].includes(r.status) && 
    (!r.batchId || r.batchId === null)
  );
  
  console.log(`\nPending Registrations (no batch, status NEW/PROCESSING/WAITING): ${pendingRegs.length}`);
  
  if (pendingRegs.length > 0) {
    console.log("Sample pending registration:");
    console.log(JSON.stringify(pendingRegs[0], null, 2));

    // Check payments for these pending
    const pendingIds = pendingRegs.map(r => r._id?.$oid || r._id);
    const paidPayments = payments.filter(p => pendingIds.includes(p.registrationId?.$oid || p.registrationId));
    
    console.log(`\nPayments found for these pending registrations: ${paidPayments.length}`);
    if (paidPayments.length > 0) {
      console.log("Sample payment:");
      console.log(JSON.stringify(paidPayments[0], null, 2));
    }
    
    // Specifically check if these payments have status 'PAID' or 'COMPLETED' or something else
    const statusCounts = {};
    paidPayments.forEach(p => {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    });
    console.log(`Payment statuses for pending registrations:`, statusCounts);
  } else {
      console.log("All registrations seem to have batchId, or status is different.");
      const regStatuses = {};
      registrations.forEach(r => {
        regStatuses[r.status] = (regStatuses[r.status] || 0) + 1;
      });
      console.log("Registration statuses:", regStatuses);
  }

} catch (e) {
  console.error(e);
}
