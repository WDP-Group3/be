import { getAllLeads, createLead, assignLead, updateLeadStatus } from '../controllers/lead.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authenticate, getAllLeads);
router.post('/', createLead);
router.patch('/:leadId/assign', authenticate, assignLead);
router.patch('/:leadId/status', authenticate, updateLeadStatus);

export default router;
