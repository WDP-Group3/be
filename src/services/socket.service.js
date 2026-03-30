import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "https://fe-git-main-nthm1806s-projects.vercel.app",
      ].filter(Boolean),
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Join user to their personal room for targeted notifications
    socket.on('join', (userId) => {
      socket.join(`user:${userId}`);
      console.log(`👤 User ${userId} joined room: user:${userId}`);
    });

    // Join admin room
    socket.on('join-admin', () => {
      socket.join('admin');
      console.log(`👑 Admin joined room: admin`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });

  global.io = io;
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

// Emit payment success event to specific user
export const emitPaymentSuccess = (userId, data) => {
  if (io) {
    io.to(`user:${userId}`).emit('payment-success', data);
    console.log(`💰 Emitted payment-success to user:${userId}`);
  }
};

// Emit new registration event to admin
export const emitNewRegistration = (data) => {
  if (io) {
    io.to('admin').emit('new-registration', data);
    console.log(`📝 Emitted new-registration to admin`);
  }
};

// Emit general notification
export const emitNotification = (userId, notification) => {
  if (io) {
    io.to(`user:${userId}`).emit('notification', notification);
  }
};

// Emit schedule update event (broadcast to everyone)
// Payload can be { instructorId, date, timeSlot, status } to target specific UI updates
export const emitScheduleUpdate = (payload) => {
  if (io) {
    io.emit('schedule-updated', payload);
    console.log(`📅 Emitted schedule-updated globally`, payload);
  }
};
