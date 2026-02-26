import Blog from "../models/Blog.js";


// ADMIN ĐĂNG BÀI
export const createBlog = async (req, res) => {
    try {

        const { title, content, thumbnail, author } = req.body;

        const blog = new Blog({
            title,
            content,
            thumbnail,
            author
        });

        await blog.save();

        res.status(201).json({
            message: "Tạo bài viết thành công",
            blog
        });

    } catch (error) {
        res.status(500).json({
            message: "Lỗi tạo blog",
            error: error.message
        });
    }
};



// ADMIN SỬA BÀI
export const updateBlog = async (req, res) => {
    try {

        const { id } = req.params;

        const updatedBlog = await Blog.findByIdAndUpdate(
            id,
            req.body,
            { new: true }
        );

        if (!updatedBlog) {
            return res.status(404).json({
                message: "Không tìm thấy bài viết"
            });
        }

        res.json({
            message: "Cập nhật bài viết thành công",
            blog: updatedBlog
        });

    } catch (error) {
        res.status(500).json({
            message: "Lỗi cập nhật blog",
            error: error.message
        });
    }
};



// ADMIN ẨN BÀI
export const hideBlog = async (req, res) => {
    try {

        const { id } = req.params;

        const blog = await Blog.findByIdAndUpdate(
            id,
            { status: "HIDDEN" },
            { new: true }
        );

        if (!blog) {
            return res.status(404).json({
                message: "Không tìm thấy bài viết"
            });
        }

        res.json({
            message: "Đã ẩn bài viết",
            blog
        });

    } catch (error) {
        res.status(500).json({
            message: "Lỗi ẩn bài viết",
            error: error.message
        });
    }
};


// USER LẤY DANH SÁCH BLOG
export const getBlogs = async (req, res) => {
    try {

        const blogs = await Blog.find({ status: "VISIBLE" })
            .sort({ createdAt: -1 });

        res.json({
            total: blogs.length,
            blogs
        });

    } catch (error) {
        res.status(500).json({
            message: "Lỗi lấy danh sách blog",
            error: error.message
        });
    }
};



// USER LẤY CHI TIẾT BLOG
export const getBlogById = async (req, res) => {
    try {

        const { id } = req.params;

        const blog = await Blog.findById(id);

        if (!blog || blog.status === "HIDDEN") {
            return res.status(404).json({
                message: "Không tìm thấy bài viết"
            });
        }

        res.json(blog);

    } catch (error) {
        res.status(500).json({
            message: "Lỗi lấy blog",
            error: error.message
        });
    }
};