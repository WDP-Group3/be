import Banner from '../models/Banner.js';

// Lấy tất cả banners
export const getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });
    res.json({
      status: 'success',
      data: banners,
      count: banners.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy banner theo ID
export const getBannerById = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);
    
    if (!banner) {
      return res.status(404).json({
        status: 'error',
        message: 'Banner not found',
      });
    }
    
    res.json({
      status: 'success',
      data: banner,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

