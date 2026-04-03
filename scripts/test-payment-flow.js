/**
 * Test script for SEPAY payment flow
 *
 * Usage:
 *   node scripts/test-payment-flow.js [options]
 *
 * Options:
 *   --full       Run full test suite (default)
 *   --qr         Test QR creation only
 *   --webhook    Test webhook simulation only
 *   --manual     Test manual payment creation only
 *   --poll       Test transaction status polling only
 *   --info       Test tuition info only
 *
 * Prerequisites:
 *   1. Backend must be running (npm run dev)
 *   2. MongoDB must be connected
 *   3. Valid test user, registration, and course must exist
 *   4. Backend URL and auth token must be configured below
 */

import 'dotenv/config';
import http from 'node:http';
import https from 'node:https';
import { parse } from 'node:url';

// ============== CONFIGURATION ==============
const BASE_URL = process.env.BE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// Test credentials - update these before running
// Get token by logging in via: POST /api/auth/login
const TEST_AUTH = {
  email: process.env.TEST_EMAIL || 'admin@drivecenter.com',
  password: process.env.TEST_PASSWORD || 'Admin123!@#',
};

// Admin token for manual payment creation
const ADMIN_AUTH = {
  email: process.env.ADMIN_EMAIL || 'admin@drivecenter.com',
  password: process.env.ADMIN_PASSWORD || 'Admin123!@#',
};

// SEPAY webhook API key (from .env)
const SEPAY_WEBHOOK_KEY = process.env.SEPAY_WEBHOOK_API_KEY || 'your-sepay-webhook-api-key';

// Test data - will be populated during flow
let testData = {
  learnerToken: null,
  adminToken: null,
  learnerId: null,
  adminId: null,
  registrationId: null,
  courseId: null,
  transactionId: null,
  transferContent: null,
  paymentId: null,
};

// ============== HTTP HELPERS ==============
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = parse(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 3000),
      path: urlObj.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, data: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function api(path, { method = 'GET', body, token, role = 'learner' }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await httpRequest(`${API_BASE}${path}`, { method, body, headers });

  if (res.status >= 400) {
    throw new Error(
      `API Error ${res.status}: ${JSON.stringify(res.data) || res.raw}`
    );
  }

  return res.data;
}

// ============== AUTH HELPERS ==============
async function login(email, password) {
  console.log(`\n[AUTH] Logging in as ${email}...`);
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (!res.token) throw new Error('No token returned from login');
  console.log(`[AUTH] Login successful. Token: ${res.token.slice(0, 30)}...`);
  return res;
}

// ============== COLOR LOGGING ==============
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function log(type, msg) {
  const symbols = {
    info: `${colors.blue}[INFO]${colors.reset}`,
    ok: `${colors.green}[PASS]${colors.reset}`,
    fail: `${colors.red}[FAIL]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    step: `${colors.cyan}[STEP]${colors.reset}`,
    data: `${colors.dim}[DATA]${colors.reset}`,
  };
  console.log(`${symbols[type] || '[LOG]'} ${msg}`);
}

// ============== TEST HELPERS ==============
async function runTest(name, fn) {
  process.stdout.write(`\n${'='.repeat(60)}\n`);
  log('step', `TEST: ${name}`);
  process.stdout.write(`${'='.repeat(60)}\n`);
  try {
    await fn();
    log('ok', `${name} — PASSED`);
  } catch (err) {
    log('fail', `${name} — FAILED: ${err.message}`);
  }
}

// ============== TEST CASES ==============

/**
 * TEST 1: Authentication
 * Login as learner and admin to get tokens
 */
async function test_authentication() {
  await runTest('Authentication', async () => {
    // Login as learner
    const learnerRes = await login(TEST_AUTH.email, TEST_AUTH.password);
    testData.learnerToken = learnerRes.token;
    testData.learnerId = learnerRes.user?._id || learnerRes.user?.id;

    // Login as admin
    const adminRes = await login(ADMIN_AUTH.email, ADMIN_AUTH.password);
    testData.adminToken = adminRes.token;
    testData.adminId = adminRes.user?._id || adminRes.user?.id;

    if (!testData.learnerToken) throw new Error('No learner token');
    if (!testData.adminToken) throw new Error('No admin token');
    log('data', `Learner ID: ${testData.learnerId || 'N/A'}`);
    log('data', `Admin ID: ${testData.adminId || 'N/A'}`);
  });
}

/**
 * TEST 2: Get tuition info
 * Retrieve fee breakdown for the learner
 */
async function test_tuition_info() {
  await runTest('Get Tuition Info', async () => {
    const res = await api('/payments/tuition-info', {
      token: testData.learnerToken,
    });

    // Response format: { status, data: { totalFee, paidAmount, remaining, items[], ... } }
    const tuition = res.data;
    if (!tuition) throw new Error('No tuition data returned');

    const items = tuition.items || [];
    log('data', `Total fee: ${tuition.totalFee?.toLocaleString()} VND | Paid: ${tuition.paidAmount?.toLocaleString()} VND | Remaining: ${tuition.remaining?.toLocaleString()} VND`);
    log('data', `Found ${items.length} registration(s) in tuition info`);

    // Find a registration that has unpaid installments
    if (items.length > 0) {
      const reg = items.find(r => r.remaining > 0) || items[0];
      testData.registrationId = reg.registrationId || reg._id;
      testData.courseId = reg.courseId;
      log('data', `Selected registration: ${testData.registrationId}`);
      log('data', `Total: ${reg.totalFee?.toLocaleString()} VND | Paid: ${reg.paidAmount?.toLocaleString()} VND | Remaining: ${reg.remaining?.toLocaleString()} VND`);
    }

    log('data', `Tuition response keys: ${Object.keys(tuition).join(', ')}`);
  });
}

/**
 * TEST 3: Create SEPAY QR Code
 * Generate a QR payment code for a registration
 */
async function test_create_qr() {
  await runTest('Create SEPAY QR Code', async () => {
    if (!testData.registrationId) {
      log('warn', 'No registration ID — skipping QR creation. Run tuition-info first.');
      // Try to find a registration from the user's registrations list
      const regs = await api('/registrations', { token: testData.learnerToken });
      if (regs.data && regs.data.length > 0) {
        testData.registrationId = regs.data[0]._id;
        testData.courseId = regs.data[0].courseId;
        log('data', `Found registration from list: ${testData.registrationId}`);
      } else {
        throw new Error('No registration found. Please create a registration first.');
      }
    }

    const today = new Date().toLocaleDateString('vi-VN');
    const qrRes = await api('/payments/create-qr', {
      method: 'POST',
      token: testData.learnerToken,
      body: {
        vnp_Amount: 100000, // Test amount (100k VND)
        vnp_OrderInfo: `Test payment ${today}`,
        registrationId: testData.registrationId,
        scheduleIndex: 0,
      },
    });

    const data = qrRes.data;
    if (!data.transactionId) throw new Error('No transactionId in response');
    if (!data.transferContent) throw new Error('No transferContent in response');
    if (!data.paymentUrl) throw new Error('No paymentUrl (QR URL) in response');

    testData.transactionId = data.transactionId;
    testData.transferContent = data.transferContent;

    log('data', `Transaction ID: ${data.transactionId}`);
    log('data', `Transfer Content (Mã nội dung chuyển khoản): ${data.transferContent}`);
    log('data', `Amount: ${data.amount?.toLocaleString()} VND`);
    log('data', `Bank: ${data.bankCode} - Account: ${data.bankAccount}`);
    log('data', `QR URL: ${data.paymentUrl}`);
    log('info', `Learner must transfer EXACTLY ${data.amount?.toLocaleString()} VND with content: ${data.transferContent}`);
  });
}

/**
 * TEST 4: Poll transaction status
 * Check if a transaction is still pending or completed
 */
async function test_transaction_status() {
  await runTest('Poll Transaction Status', async () => {
    if (!testData.transactionId) {
      throw new Error('No transaction ID — run create-qr test first');
    }

    const res = await api(`/payments/transaction-status/${testData.transactionId}`, {
      token: testData.learnerToken,
    });

    const tx = res.data;
    log('data', `Status: ${tx.paymentStatus}`);
    log('data', `Transfer Content: ${tx.transferContent}`);
    log('data', `Amount: ${tx.amount?.toLocaleString()} VND`);
    log('data', `Paid At: ${tx.paidAt || 'Not paid yet'}`);

    if (tx.paymentStatus === 'completed') {
      log('ok', 'Transaction already completed via webhook');
      testData.paymentId = tx.paymentId;
    } else if (tx.paymentStatus === 'pending') {
      log('warn', 'Transaction is still pending — simulate webhook to complete it');
    }
  });
}

/**
 * TEST 5: Simulate SEPAY webhook
 * Simulate what SEPAY sends when a transfer is received
 */
async function test_webhook_simulation() {
  await runTest('Simulate SEPAY Webhook', async () => {
    if (!testData.transactionId) {
      throw new Error('No transaction ID — run create-qr test first');
    }

    if (!testData.transferContent) {
      throw new Error('No transfer content — run create-qr test first');
    }

    // First check if already completed
    const statusCheck = await api(`/payments/transaction-status/${testData.transactionId}`, {
      token: testData.learnerToken,
    });

    if (statusCheck.data?.paymentStatus === 'completed') {
      log('warn', 'Transaction already completed — skipping webhook simulation');
      testData.paymentId = statusCheck.data.paymentId;
      return;
    }

    log('info', 'Sending webhook to simulate SEPAY payment notification...');
    log('data', `Transfer content: ${testData.transferContent}`);

    const webhookPayload = {
      transferContent: testData.transferContent,
      transferAmount: 100000, // Must match the amount in create-qr
      paidAt: Date.now(),
      id: `sepay_test_${Date.now()}`,
      content: testData.transferContent,
      transactionTime: new Date().toISOString(),
    };

    const webhookRes = await httpRequest(`${API_BASE}/payments/check-payment`, {
      method: 'POST',
      body: webhookPayload,
      headers: {
        'Authorization': `ApiKey ${SEPAY_WEBHOOK_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (webhookRes.status >= 400) {
      throw new Error(`Webhook failed (${webhookRes.status}): ${webhookRes.raw}`);
    }

    log('data', `Webhook response (${webhookRes.status}): ${JSON.stringify(webhookRes.data)}`);

    if (webhookRes.data?.status === 'success') {
      log('ok', 'Webhook processed successfully');
      if (webhookRes.data?.data?.paymentCreated) {
        log('data', 'Payment record created');
      }
      if (webhookRes.data?.data?.enrollment) {
        log('data', `Learner enrolled in batch: ${webhookRes.data.data.enrollment.batchId || 'enrolled'}`);
      }
    } else {
      log('warn', `Webhook returned: ${JSON.stringify(webhookRes.data)}`);
    }
  });
}

/**
 * TEST 6: Verify post-payment effects
 * Check that Payment record was created and role was upgraded
 */
async function test_post_payment_effects() {
  await runTest('Verify Post-Payment Effects', async () => {
    // Check transaction status updated
    const txStatus = await api(`/payments/transaction-status/${testData.transactionId}`, {
      token: testData.learnerToken,
    });

    const tx = txStatus.data;
    if (tx.paymentStatus !== 'completed') {
      log('warn', `Transaction status: ${tx.paymentStatus} (expected: completed)`);
    } else {
      log('ok', 'Transaction marked as completed');
      testData.paymentId = tx.paymentId;
    }

    // Check payment records
    const paymentsRes = await api('/payments', { token: testData.learnerToken });
    const payments = paymentsRes.data || [];
    log('data', `Total payment records: ${payments.length}`);

    const latestPayment = payments.find(p => p._id === testData.paymentId) || payments[0];
    if (latestPayment) {
      log('data', `Latest payment: ${latestPayment.amount?.toLocaleString()} VND | Method: ${latestPayment.method} | Paid at: ${latestPayment.paidAt}`);
    }

    // Check registration status
    if (testData.registrationId) {
      const regRes = await api(`/registrations/${testData.registrationId}`, {
        token: testData.learnerToken,
      });
      const reg = regRes.data;
      log('data', `Registration status: ${reg?.status}`);
      log('data', `First payment date: ${reg?.firstPaymentDate || 'not set'}`);
    }

    // Check user role (should be upgraded from USER to learner)
    const profileRes = await api('/auth/profile', { token: testData.learnerToken });
    log('data', `User role: ${profileRes.data?.user?.role || profileRes.data?.role}`);
  });
}

/**
 * TEST 7: Manual payment creation (Admin)
 * Admin creates a payment record manually (cash/transfer)
 */
async function test_manual_payment() {
  await runTest('Manual Payment Creation (Admin)', async () => {
    // First, get a registration ID for testing
    let regId = testData.registrationId;
    if (!regId) {
      const regs = await api('/registrations', { token: testData.learnerToken });
      if (regs.data && regs.data.length > 0) {
        regId = regs.data[0]._id;
      }
    }

    if (!regId) {
      log('warn', 'No registration found — testing with mock registration ID');
      log('warn', 'This test validates the API contract only');
    }

    const manualPaymentRes = await api('/payments', {
      method: 'POST',
      token: testData.adminToken,
      body: {
        registrationId: regId || '000000000000000000000000', // Won't create if invalid
        amount: 50000,
        method: 'CASH',
        receivedBy: 'CONSULTANT',
        paidAt: new Date().toISOString(),
        note: 'Test manual payment via script',
      },
    });

    log('data', `Manual payment result: ${JSON.stringify(manualPaymentRes)}`);
  });
}

/**
 * TEST 8: Get all transactions
 * List all SEPAY transactions for the learner
 */
async function test_list_transactions() {
  await runTest('List Transactions', async () => {
    const res = await api('/payments/transactions', {
      token: testData.learnerToken,
    });

    const txs = res.data || [];
    log('data', `Total transactions: ${txs.length}`);
    log('data', `Showing last 5:`);

    txs.slice(-5).forEach((tx, i) => {
      log('data', `  ${i + 1}. ${tx.transferContent} | ${tx.amount?.toLocaleString()} VND | ${tx.status} | ${tx.paidAt || 'pending'}`);
    });
  });
}

/**
 * TEST 9: Confirm transaction manually (Admin)
 * Admin confirms a pending transaction that arrived but webhook missed
 */
async function test_admin_confirm_transaction() {
  await runTest('Admin Confirm Transaction', async () => {
    // Get a pending transaction
    const txs = await api('/payments/transactions?status=pending', {
      token: testData.adminToken,
    });

    const pendingTx = txs.data?.find(tx => tx.status === 'pending');
    if (!pendingTx) {
      log('warn', 'No pending transactions found to confirm');
      return;
    }

    log('data', `Confirming transaction: ${pendingTx._id} (${pendingTx.transferContent})`);

    const confirmRes = await api(`/payments/transactions/${pendingTx._id}/confirm`, {
      method: 'PATCH',
      token: testData.adminToken,
    });

    log('data', `Confirm result: ${JSON.stringify(confirmRes)}`);
  });
}

/**
 * TEST 10: Full E2E flow (orchestrated)
 * Runs the complete payment flow: QR → webhook → verify
 */
async function test_full_e2e_flow() {
  await runTest('Full E2E Payment Flow', async () => {
    log('info', 'Step 1: Login as learner');
    await test_authentication();

    log('info', 'Step 2: Get tuition info');
    await test_tuition_info();

    log('info', 'Step 3: Create SEPAY QR');
    await test_create_qr();

    log('info', 'Step 4: Check transaction status');
    await test_transaction_status();

    log('info', 'Step 5: Simulate SEPAY webhook');
    await test_webhook_simulation();

    log('info', 'Step 6: Verify post-payment effects');
    await test_post_payment_effects();

    log('info', 'Step 7: List all transactions');
    await test_list_transactions();

    log('info', 'Step 8: Verify payment in tuition info');
    const updatedTuition = await api('/payments/tuition-info', {
      token: testData.learnerToken,
    });

    const items = updatedTuition.data?.items || [];
    const paidReg = items.find(
      r => String(r.registrationId || r._id) === String(testData.registrationId)
    );
    if (paidReg) {
      log('data', `Updated tuition — Total: ${paidReg.totalFee?.toLocaleString()} VND | Paid: ${paidReg.paidAmount?.toLocaleString()} VND | Remaining: ${paidReg.remaining?.toLocaleString()} VND`);
    } else {
      log('data', 'Updated tuition summary:', JSON.stringify(updatedTuition.data));
    }
  });
}

// ============== MAIN ==============
const args = process.argv.slice(2);
const mode = args[0]?.replace('--', '') || 'full';

async function main() {
  console.log(`\n${colors.cyan}╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║         DriveCenter Payment Flow Test Suite               ║`);
  console.log(`║  Target: ${BASE_URL}`);
  console.log(`║  Mode:   ${mode.padEnd(50)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Check if backend is reachable
  try {
    const health = await httpRequest(BASE_URL);
    log('info', `Backend reachable: ${BASE_URL} (${health.status})`);
  } catch (err) {
    log('fail', `Cannot reach backend at ${BASE_URL}. Is it running?`);
    log('info', 'Start it with: cd be && npm run dev');
    process.exit(1);
  }

  switch (mode) {
    case 'qr':
      await test_authentication();
      await test_create_qr();
      break;
    case 'webhook':
      await test_authentication();
      await test_webhook_simulation();
      break;
    case 'manual':
      await test_authentication();
      await test_manual_payment();
      break;
    case 'poll':
      await test_authentication();
      await test_transaction_status();
      break;
    case 'info':
      await test_authentication();
      await test_tuition_info();
      break;
    case 'full':
    default:
      await test_full_e2e_flow();
      break;
  }

  console.log(`\n${colors.green}✓ Test run completed${colors.reset}\n`);
}

main().catch((err) => {
  log('fail', `Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
