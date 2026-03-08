import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true
        },

        content: {
            type: String,
            required: true
        },
        category: {
            type: String,
            enum: ['Những lỗi thường gặp', 'Kinh nghiệm sa hình', 'Những điều cần lưu ý khi đi thi'],
            default: 'Những điều cần lưu ý khi đi thi'
        },

        thumbnail: {
            type: String
        },

        author: {
            type: String
        },

        rating: {
            type: Number,
            default: 0
        },

        ratingCount: {
            type: Number,
            default: 0
        },

        status: {
            type: String,
            enum: ["VISIBLE", "HIDDEN"],
            default: "VISIBLE"
        }

    },
    {
        timestamps: true
    }
);

const Blog = mongoose.model("Blog", blogSchema);

export default Blog;