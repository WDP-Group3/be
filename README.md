# Backend API Server

Backend API server được xây dựng với Node.js, Express và MongoDB Atlas (Mongoose).

## Cài đặt

1. Cài đặt dependencies:
```bash
npm install
```

2. Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```

3. Cập nhật các biến môi trường trong file `.env`:
   - `MONGODB_URI`: Connection string từ MongoDB Atlas
   - `DB_NAME`: Tên database
   - `PORT`: Port cho server (mặc định: 3000)
   - `NODE_ENV`: Môi trường (development/production)

## Chạy server

### Development mode (với auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

## Cấu trúc thư mục

```
be/
├── src/
│   ├── config/
│   │   └── db.js          # Cấu hình kết nối MongoDB
│   ├── controllers/       # Controllers (sẽ thêm sau)
│   ├── models/            # Mongoose models (sẽ thêm sau)
│   ├── routes/            # API routes (sẽ thêm sau)
│   └── server.js          # Entry point của server
├── .env.example           # Template cho biến môi trường
├── .gitignore
├── package.json
└── README.md
```

## API Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check

## MongoDB Atlas Setup

1. Tạo cluster trên [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Lấy connection string
3. Cập nhật `MONGODB_URI` trong file `.env`

## Technologies

- **Node.js** - Runtime environment
- **Express** - Web framework
- **Mongoose** - MongoDB ODM
- **dotenv** - Environment variables
- **cors** - Cross-Origin Resource Sharing

