import Document from '../models/Document.js';

// Lấy tất cả documents
export const getAllDocuments = async (req, res) => {
  try {
    const { registrationId, status } = req.query;
    const filter = {};
    
    if (registrationId) filter.registrationId = registrationId;
    if (status) filter.status = status;
    
    const documents = await Document.find(filter)
      .populate('registrationId', 'studentId batchId')
      .sort({ _id: -1 });
    
    res.json({
      status: 'success',
      data: documents,
      count: documents.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy document theo ID
export const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id)
      .populate('registrationId');
    
    if (!document) {
      return res.status(404).json({
        status: 'error',
        message: 'Document not found',
      });
    }
    
    res.json({
      status: 'success',
      data: document,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

